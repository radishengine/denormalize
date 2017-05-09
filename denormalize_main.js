requirejs.config({
  waitSeconds: 0,
});

define([],
function() {

  'use strict';
  
  var ac = new AudioContext();
  
  const BUFFER_SIZE = 64 * 1024;
  
  Blob.prototype.readBuffered = function(sliceFrom, sliceTo) {
    var buf = this.buffer;
    if (buf && sliceFrom >= buf.bufferOffset && sliceTo <= (buf.bufferOffset + buf.byteLength)) {
      return Promise.resolve(new Uint8Array(buf, sliceFrom - buf.bufferOffset, sliceTo - sliceFrom));
    }
    var bufferStart = Math.floor(sliceFrom / BUFFER_SIZE) * BUFFER_SIZE;
    var bufferEnd = Math.min(this.size, Math.ceil(sliceTo / BUFFER_SIZE) * BUFFER_SIZE);
    var self = this;
    return new Promise(function(resolve, reject) {
      var fr = new FileReader;
      fr.onload = function() {
        var buf = this.result;
        buf.bufferOffset = bufferStart;
        self.buffer = buf;
        resolve(new Uint8Array(buf, sliceFrom - bufferStart, sliceTo - sliceFrom));
      };
      fr.onerror = function() {
        reject(this.error);
      };
      fr.readAsArrayBuffer(self.slice(bufferStart, bufferEnd));
    });
  };
  
  function GDVHeaderSpec(buffer, byteOffset, byteLength) {
    this.dv = new DataView(buffer, byteOffset, byteLength);
  }
  GDVHeaderSpec.prototype = {
    get signature() {
      return this.dv.getUint32(0, true);
    },
    get hasValidSignature() {
      return (this.signature === 0x29111994);
    },
    // ignore: 2 bytes
    get frameCount() {
      return this.dv.getUint16(6, true);
    },
    get framesPerSecond() {
      return this.dv.getUint16(8, true);
    },
    get audioFlags() {
      return this.dv.getUint16(10, true);
    },
    get audioIsDPCM() {
      return !!(this.audioFlags & 8);
    },
    get audioBytesPerSample() {
      return (this.audioFlags & 4) ? 2 : 1;
    },
    get audioChannels() {
      return (this.audioFlags & 2) ? 2 : 1;
    },
    get audioIsPresent() {
      return !!(this.audioFlags & 1);
    },
    get sampleRate() {
      return this.dv.getUint16(12, true);
    },
    get videoFlags() {
      return this.dv.getUint16(14, true);
    },
    get bitsPerPixel() {
      switch (this.videoFlags & 7) {
        case 1: return 8;
        case 2: return 15;
        case 3: return 16;
        case 4: return 24;
       }
    },
    get maxFrameSize() {
      return this.dv.getUint16(16, true);
    },
    get videoIsPresent() {
      return (this.maxFrameSize !== 0);
    },
    // ignore: 2 bytes
    get videoWidth() {
      return this.dv.getUint16(20, true);
    },
    get videoHeight() {
      return this.dv.getUint16(22, true);
    },
    get frameDataOffset() {
      return (this.bitsPerPixel === 8) ? 24 + 256*3 : 24;
    },
    get audioChunkSize() {
      var size = Math.floor(this.sampleRate / this.framesPerSecond);
      size *= this.audioChannels;
      size *= this.audioBytesPerSample;
      if (this.audioIsDPCM) size /= 2;
      Object.defineProperty(this, 'audioChunkSize', {value:size, enumerable:true});
      return size;
    },
    get durationString() {
      var seconds = this.frameCount / this.framesPerSecond;
      var minutes = (seconds / 60) | 0;
      seconds = (seconds % 60) | 0;
      return ('0' + minutes).slice(-2) + ':' + ('0' + seconds).slice(-2);
    },
  };
  
  function GDV(blob) {
    this.blob = blob;
  }
  GDV.prototype = {
    get retrievedHeader() {
      var promise = this.blob.readBuffered(0, 24).then(function(bytes) {
        return new GDVHeaderSpec(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      });
      Object.defineProperty(this, 'retrievedInfo', {value:promise, enumerable:true});
      return promise;
    },
    get retrievedPalette() {
      var self = this;
      var promise = this.retrievedHeader.then(function(header) {
        if (header.bitsPerPixel !== 8) return null;
        return self.blob.readBuffered(24, 24 + 256*3).then(function(bytes) {
          var pal = new Uint8Array(256 * 4);
          for (var i = 0; i < 256; i++) {
            var r = bytes[i*3], g = bytes[i*3 + 1], b = bytes[i*3 + 2];
            r = (r << 2) | (r >>> 4);
            g = (g << 2) | (g >>> 4);
            b = (b << 2) | (b >>> 4);
            pal[i*4] = r;
            pal[i*4 + 1] = g;
            pal[i*4 + 2] = b;
            pal[i*4 + 3] = 0xff;
          }
          return new Uint32Array(pal.buffer, pal.byteOffset, 256);
        });
      });
      Object.defineProperty(this, 'retrievedPalette', {value:promise, enumerable:true});
      return promise;      
    },
  };
  
  console.log('hello... newman world');
  
  var dragdrop = document.getElementById('dragdrop');
  
  function createSection(title) {
    var div = document.createElement('DIV');
    div.classList.add('section');
    div.appendChild(div.closeButton = document.createElement('BUTTON'));
    div.closeButton.classList.add('close_button');
    div.closeButton.innerText = 'X';
    div.closeButton.onclick = function() {
      div.parentNode.removeChild(div);
    };
    div.appendChild(div.titleElement = document.createElement('H3'));
    div.titleElement.innerText = title || '';
    if (dragdrop.nextSibling) {
      dragdrop.parentNode.insertBefore(div, dragdrop.nextSibling);
    }
    else {
      dragdrop.parentNode.appendChild(div);
    }
    var inside = document.createElement('DIV');
    inside.classList.add('content');
    div.appendChild(inside);
    div.appendChild(inside.buttons = document.createElement('DIV'));
    inside.titleElement = div.titleElement;
    return inside;
  }
  
  function onfile(file) {
    var section = createSection(file.name);
    if (/\.gdv$/i.test(file.name)) {
      var gdv = new GDV(file);
      gdv.retrievedHeader.then(function(header) {
        section.titleElement.innerText += ' (' + header.durationString + ')';
        if (header.videoIsPresent) {
          section.appendChild(section.display = document.createElement('CANVAS'));
          section.display.width = header.videoWidth;
          section.display.height = header.videoHeight;
          section.ctx2d = section.display.getContext('2d');
          section.pixelBuffer = section.ctx2d.createImageData(section.display.width, section.display.height);
          section.ctx2d.fillStyle = 'black';
          section.ctx2d.fillRect(0, 0, section.display.width, section.display.height);
        }
        section.addEventListener('play', function() {
          var destination = ac.createGain();
          destination.connect(ac.destination);
          section.dispatchEvent(new CustomEvent('playing'));
          var frameCount = header.frameCount;
          const baseTime = ac.currentTime;
          var nextFrameTime = baseTime;
          var reqId = null;
          function stop() {
            if (reqId !== null) {
              cancelAnimationFrame(reqId);
              reqId = null;
            }
            destination.disconnect();
            section.removeEventListener('stop', stop);
            section.dispatchEvent(new CustomEvent('stopped'));
          }
          section.addEventListener('stop', stop);
          var readOffset = header.frameDataOffset;
          function onAnimationFrame() {
            reqId = null;
            if (frameCount < 1) {
              section.display.dispatchEvent(new CustomEvent('stop'));
              return;
            }
            if (ac.currentTime < nextFrameTime) {
              return;
            }
            var thisFrameTime = nextFrameTime;
            nextFrameTime += 1/header.framesPerSecond;
            frameCount--;
            if (header.audioIsPresent) {
              file.readBuffered(readOffset, readOffset + header.audioChunkSize)
              .then(function(audioChunk) {
                var sample = ac.createBufferSource();
                sample.connect(destination);
                var sampleCount = Math.floor(header.sampleRate / header.framesPerSecond);
                sample.buffer = ac.createBuffer(2, sampleCount, header.sampleRate);
                const c = header.audioChannels;
                var f32 = new Array(c);
                for (var i = 0; i < c; i++) {
                  f32[i] = sample.buffer.getChannelData(i);
                }
                switch (header.audioBytesPerSample) {
                  case 1:
                    for (var i = 0; i < sampleCount; i++) {
                      f32[i%c][(i/c)|0] = audioChunk[i];
                    }
                    break;
                  default:
                    throw new Error('unsupported');
                }
                sample.play(thisFrameTime);
              });
              readOffset += header.audioChunkSize;
            }
            if (header.videoIsPresent) {
              file.readBuffered(readOffset, readOffset + 4 + header.maxFrameSize)
              .then(function(frameData) {
                var dv = new DataView(frameData.buffer, frameData.byteOffset, 8);
                if (dv.getUint16(0, true) !== 0x1305) {
                  throw new Error('video frame header not found');
                }
                var dataSize = dv.getUint16(2, true);
                var frameFlags = dv.getUint32(4, true);
                readOffset += 8 + dataSize;
                reqId = requestAnimationFrame(onAnimationFrame);
                frameData = frameData.subarray(8, 8 + dataSize);
                var encoding = frameFlags & 15;
                var offset = (frameFlags >>> 8);
                var halfResMode = !!(frameFlags & 32);
                var quarterResMode = !!(frameFlags & 16);
                var show = !!(frameFlags & 128);
              });
            }
            else {
              reqId = requestAnimationFrame(onAnimationFrame);
            }
          }
          reqId = requestAnimationFrame(onAnimationFrame);
        });
        section.buttons.appendChild(section.playButton = document.createElement('BUTTON'));
        section.playButton.innerText = 'Play';
        section.playButton.onclick = function() {
          section.dispatchEvent(new CustomEvent('play'));
        };
        section.addEventListener('playing', function() {
          section.playButton.disabled = true;
        });
        section.addEventListener('stopped', function() {
          section.playButton.disabled = false;
        });
        
        section.buttons.appendChild(section.stopButton = document.createElement('BUTTON'));
        section.stopButton.innerText = 'Stop';
        section.stopButton.onclick = function() {
          section.dispatchEvent(new CustomEvent('stop'));
        };
        section.addEventListener('playing', function() {
          section.stopButton.disabled = false;
        });
        section.addEventListener('stopped', function() {
          section.stopButton.disabled = true;
        });
        section.stopButton.disabled = true;
      });
    }
    else {
      section.innerText = 'unknown: ' + file.name;
    }
  }
  
  dragdrop.ondragenter = function(e) {
    if (e.target !== this) return;
  };
  
  dragdrop.ondragover = function(e) {
    this.classList.add('dropping');
    e.preventDefault();
  };
  
  dragdrop.ondragleave = function(e) {
    if (e.target !== this) return;
    this.classList.remove('dropping');
  };
  
  dragdrop.ondrop = function(e) {
    e.preventDefault();
    this.classList.remove('dropping');
    for (var i = e.dataTransfer.files.length - 1; i >= 0; i--) {
      onfile(e.dataTransfer.files[i]);
    }
  };
  
});
