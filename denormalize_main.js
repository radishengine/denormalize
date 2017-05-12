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
  
  Blob.prototype.readArrayBuffer = function() {
    var self = this;
    return new Promise(function(resolve, reject) {
      var fr = new FileReader;
      fr.onload = function() {
        resolve(this.result);
      };
      fr.onerror = function() {
        reject(this.error);
      };
      fr.readAsArrayBuffer(self);
    });
  };
  
  Blob.prototype.readAllBytes = function() {
    return this.readArrayBuffer().then(function(ab) {
      return new Uint8Array(ab);
    });
  };
  
  function GDVFileHeader(buffer, byteOffset, byteLength) {
    this.dv = new DataView(buffer, byteOffset, byteLength);
  }
  GDVFileHeader.prototype = {
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
  
  function GDVFrameHeader(buffer, byteOffset, byteLength) {
    this.dv = new DataView(buffer, byteOffset, byteLength);
  }
  GDVFrameHeader.prototype = {
    get signature() {
      return this.dv.getUint16(0, true);
    },
    get hasValidSignature() {
      return (this.signature === 0x1305);
    },
    get dataByteLength() {
      return this.dv.getUint16(2, true);
    },
    get flags() {
      return this.dv.getUint32(4, true);
    },
    get encoding() {
      return this.flags & 15;
    },
    get offset() {
      return this.flags >>> 8;
    },
    get halfResMode() {
      return !!(this.flags & 32);
    },
    get quarterResMode() {
      return !!(this.flags & 16);
    },
    get isShown() {
      return !(this.flags & 128);
    },
  };
  
  function GDV(blob) {
    this.blob = blob;
  }
  GDV.prototype = {
    get retrievedHeader() {
      var promise = this.blob.readBuffered(0, 24).then(function(bytes) {
        return new GDVFileHeader(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      });
      Object.defineProperty(this, 'retrievedHeader', {value:promise, enumerable:true});
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
    get retrievedInterleavedFrames() {
      var blob = this.blob;
      var promise = this.retrievedHeader.then(function(header) {
        if (!header.videoIsPresent) {
          if (!header.audioIsPresent) return [];
          var audioOnly = [];
          var offset = header.frameDataOffset;
          for (var i = 0; i < header.frameCount; i++) {
            audioOnly.push(blob.slice(offset, offset + header.audioChunkSize));
            offset += header.audioChunkSize;
          }
          return audioOnly;
        }
        var list = [];
        function nextPart(frameCount, offset) {
          if (frameCount === 0) return list;
          if (header.audioIsPresent) {
            list.push(blob.slice(offset, offset + header.audioChunkSize));
            offset += header.audioChunkSize;
          }
          return blob.readBuffered(offset, offset + 8).then(function(frameHeader) {
            frameHeader = new GDVFrameHeader(frameHeader.buffer, frameHeader.byteOffset, frameHeader.byteLength);
            if (!frameHeader.hasValidSignature) {
              return Promise.reject('invalid frame header');
            }
            var frameBlob = blob.slice(offset + 8, offset + 8 + frameHeader.dataByteLength);
            frameBlob.header = frameHeader;
            list.push(frameBlob);
            return nextPart(frameCount - 1, offset + 8 + frameHeader.dataByteLength);
          });
        }
        return nextPart(header.frameCount, header.frameDataOffset);
      });
      Object.defineProperty(this, 'retrievedInterleavedFrames', {value:promise, enumerable:true});
      return promise;
    },
    get retrievedVideoFrames() {
      var self = this;
      var promise = this.retrievedHeader.then(function(header) {
        if (!header.videoIsPresent) return [];
        return self.retrievedInterleavedFrames.then(function(interleaved) {
          if (!header.audioIsPresent) return interleaved;
          var videoFrames = new Array(interleaved.length/2);
          for (var i = 0; i < videoFrames.length; i++) {
            videoFrames[i] = interleaved[i*2 + 1];
          }
          return videoFrames;
        });
      });
      Object.defineProperty(this, 'retrievedVideoFrames', {value:promise, enumerable:true});
      return promise;
    },
    get retrievedAudioFrames() {
      var self = this;
      var promise = this.retrievedHeader.then(function(header) {
        if (!header.audioIsPresent) return [];
        return self.retrievedInterleavedFrames.then(function(interleaved) {
          if (!header.videoIsPresent) return interleaved;
          var audioFrames = new Array(interleaved.length/2);
          for (var i = 0; i < audioFrames.length; i++) {
            audioFrames[i] = interleaved[i*2];
          }
          return audioFrames;
        });
      });
      Object.defineProperty(this, 'retrievedAudioFrames', {value:promise, enumerable:true});
      return promise;
    },
    getWav: function() {
      var self = this;
      var promise = this.retrievedHeader.then(function(header) {
        if (!header.audioIsPresent) return null;
        if (!header.videoIsPresent) {
          var data = [
            self.blob.slice(
              header.frameDataOffset,
              header.frameDataOffset + header.frameCount * header.audioChunkSize)];
          data.byteLength = data[0].size;
          return data;
        }
        return self.retrievedInterleavedFrames.then(function(interleaved) {
          var data = new Array(interleaved.length/2);
          for (var i = 0; i < data.length; i++) {
            data[i] = interleaved[i*2];
          }
          data.byteLength = data.length * header.audioChunkSize;
          return data;
        });
      });
      
      promise = Promise.all([this.retrievedHeader, promise])
      .then(function(values) {
        var header = values[0], data = values[1];
        if (!data) return null;
        
        var fmt = new DataView(new ArrayBuffer(20));
        fmt.setUint32(0, 16, true);
        fmt.setUint16(4, 1, true);
        fmt.setUint16(6, header.audioChannels, true);
        fmt.setUint32(8, header.sampleRate, true);
        fmt.setUint32(12, header.sampleRate * header.audioChannels * header.audioBytesPerSample, true);
        fmt.setUint16(16, header.audioChannels * header.audioBytesPerSample, true);
        fmt.setUint16(18, header.audioBytesPerSample * 8, true);
        
        var fileSize = new DataView(new ArrayBuffer(4));
        fileSize.setUint32(0, 36 + data.byteLength, true);
        
        var dataSize = new DataView(new ArrayBuffer(4));
        dataSize.setUint32(0, data.byteLength, true);
        
        data.splice(0, 0, 'RIFF', fileSize, 'WAVE', 'fmt ', fmt, 'data', dataSize);
        
        return new Blob(data, {type:'audio/wav'});
      });
      return promise;
    },
    getAudioBuffer: function(audioContext) {
      return this.getWav()
        .then(function(blob) {
          if (blob) {
            return blob.readArrayBuffer().then(function(arrayBuffer) {
              return audioContext.decodeAudioData(arrayBuffer);
            });
          }
          return null;
        });
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
      Promise.all([
        gdv.retrievedHeader
        ,gdv.retrievedPalette
      ]).then(function(values) {
        var header = values[0], palette = values[1];
        section.titleElement.innerText += ' (' + header.durationString + ')';
        var lastFrame;
        if (header.videoIsPresent) {
          section.appendChild(section.display = document.createElement('CANVAS'));
          section.display.width = header.videoWidth;
          section.display.height = header.videoHeight;
          section.ctx2d = section.display.getContext('2d');
          var pal0 = new Uint8Array(palette.buffer, palette.byteOffset, 3);
          section.ctx2d.fillStyle = 'rgb(' + [].join.call(pal0, ',') + ')';
          section.ctx2d.fillRect(0, 0, section.display.width, section.display.height);
          lastFrame = Promise.resolve({
            palette: palette,
            pix8: new Uint8Array(header.videoWidth * header.videoHeight),
            imageData: section.ctx2d.getImageData(0, 0, header.videoWidth, header.videoHeight),
          });
        }
        section.addEventListener('play', function() {
          Promise.all([
            gdv.retrievedVideoFrames
            ,gdv.getAudioBuffer(ac)
          ]).then(function(values) {
            var frames = values[0], buffer = values[1];
            var destination = ac.createGain();
            destination.connect(ac.destination);
            var src = ac.createBufferSource();
            src.connect(destination);
            if (buffer) src.buffer = buffer;
            const baseTime = ac.currentTime + 0.2;
            const endTime = baseTime + header.frameCount/header.framesPerSecond;
            src.start(baseTime);
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
            section.dispatchEvent(new CustomEvent('playing'));
            if (!frames || frames.length === 0) return;
            frames = frames.slice();
            var nextFrameTime = baseTime;
            var decodedFrameQueue = [];
            function decode(values) {
              var prevFrame = values[0], header = values[1], data = values[2];
              var newFrame = {
                palette: prevFrame.palette,
                pix8: prevFrame.pix8,
                imageData: prevFrame.imageData,
              };
              function redraw() {
                newFrame.imageData = section.ctx2d.createImageData(section.display.width, section.display.height);
                var pix32 = new Uint32Array(
                  newFrame.imageData.data.buffer,
                  newFrame.imageData.data.byteOffset, 
                  newFrame.imageData.data.byteLength/4);
                var pix8 = newFrame.pix8, palette = newFrame.palette;
                for (var i = 0; i < pix32.length; i++) {
                  pix32[i] = palette[pix8[i]];
                }
              }
              function findColorForInvalidOffset(offset) {
                var result = 0xFE & (~offset >>> 3);
                var lastbit = 0xF & offset;
                if (lastbit <= 8) {
                  result += lastbit ? 1 : 2;
                  result &= 0xff;
                }
                return result;
              }
              function initPixels(pixels) {
                pixels = new Uint8Array(pixels);
                if (header.quarterResMode) {
                  throw new Error('NYI');
                }
                else if (header.halfResMode) {
                  const lineSize = newFrame.imageData.width;
                  for (var pos = lineSize*2; pos < pixels.length; pos += lineSize*2) {
                    pixels.set(pixels.subarray(pos, pos + lineSize), pos >>> 1);
                  }
                }
                return pixels;
              }
              function finalizePixels(pixels) {
                if (header.quarterResMode) {
                  throw new Error('NYI');
                }
                else if (header.halfResMode) {
                  const lineSize = newFrame.imageData.width;
                  for (var pos = pixels.length/2 - lineSize; pos > 0; pos -= lineSize) {
                    var sub = pixels.subarray(pos, pos + lineSize);
                    pixels.set(sub, pos << 1);
                    pixels.set(sub, (pos << 1) + 1);
                  }
                  pixels.set(pixels.subarray(0, lineSize), lineSize);
                }
                return pixels;
              }
              function readPacked() {
                var pixels = newFrame.pix8 = initPixels(newFrame.pix8);
                
                var pixPos = header.offset;
                var dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
                var queue = dv.getUint32(0, true);
                var dataPos = 4;
                var qsize = 16;
                function readBits(n) {
                  var retVal = queue & ((1 << n) - 1);
                  queue >>>= n;
                  if ((qsize -= n) <= 0) {
                    queue |= dv.getUint16(dataPos, true) << (qsize += 16);
                    dataPos += 2;
                  }
                  return retVal;
                }
                for (;;) switch (header.encoding*10 + readBits(2)) {
                  case 60:
                  case 80:
                    if (!readBits(1)) {
                      pixels[pixPos++] = data[dataPos++];
                      continue;
                    }
                    var length = 2, count = 0, step;
                    do {
                      count++;
                      step = readBits(count);
                      length += step;
                    } while (step === ((1 << count) - 1));
                    pixels.set(data.subarray(dataPos, dataPos + length), pixPos);
                    pixPos += length;
                    dataPos += length;
                    continue;
                  case 61:
                  case 81:
                    if (!readBits(1)) {
                      pixPos += 2 + readBits(4);
                    }
                    else {
                      var b = data[dataPos++];
                      if (b & 0x80) {
                        b = ((b & 0x7F) << 8) | data[dataPos++];
                        pixPos += 146 + b;
                      }
                      else {
                        pixPos += 18 + b;
                      }
                    }
                    continue;
                  case 62:
                  case 82:
                    var subtag = readBits(2);
                    if (subtag === 3) {
                      var offset, length;
                      var b = data[dataPos++];
                      if (b & 0x80) {
                        length = 3; offset = b & 0x7F;
                      }
                      else {
                        length = 2; offset = b;
                      }
                      if (offset === 0) {
                        var repPixel = (pixPos === 0) ? 0xFF : pixels[pixPos-1];
                        while (length--) pixels[pixPos++] = repPixel;
                      }
                      else if (++offset > pixPos) {
                        var repPixel = findColorForInvalidOffset(offset - pixPos);
                        while (length--) pixels[pixPos++] = repPixel;
                      }
                      else {
                        offset = pixPos - offset;
                        pixels.set(pixels.subarray(offset, offset + length), pixPos);
                        pixPos += length;
                      }
                      continue;
                    }
                    var next4 = readBits(4);
                    var offset = (next4 << 8) | data[dataPos++];
                    if (subtag === 0 && offset > 0xF80) {
                      if (offset === 0xFFF) {
                        // end of stream
                        finalizePixels(pixels);
                        return;
                      }
                      var length = (offset & 0xF) + 2;
                      offset = (offset >>> 4) & 7;
                      var px1 = pixels[pixPos - (offset + 1)];
                      var px2 = pixels[pixPos - offset];
                      while (length--) {
                        pixels[pixPos++] = px1;
                        pixels[pixPos++] = px2;
                      }
                      continue;
                    }
                    var length = subtag + 3;
                    if (offset === 0xFFF) {
                      var repPixel = (pixPos === 0) ? 0xFF : pixels[pixPos-1];
                      while (length--) pixels[pixPos++] = repPixel;
                      continue;
                    }
                    offset = 4096 - offset;
                    if (offset > pixPos) {
                      var repPixel = findColorForInvalidOffset(offset - pixPos);
                      while (length--) pixels[pixPos++] = repPixel;
                      continue;
                    }
                    offset = pixPos - offset;
                    pixels.set(pixels.subarray(offset, offset + length), pixPos);
                    pixPos += length;
                    continue;
                  case 63:
                    var firstByte = data[dataPos++];
                    var length = firstByte >>> 4;
                    if (length === 15) {
                      length += data[dataPos++];
                    }
                    length += 6;
                    var offset = (((firstByte & 0xF) << 8) | data[dataPos++]);
                    if (offset === 0xFFF) {
                      if (pixPos === 0) {
                        var repPixel = (pixPos === 0) ? 0xFF : pixels[pixPos-1];
                        while (length--) pixels[pixPos++] = repPixel;
                        continue;
                      }
                    }
                    offset = 4096 - offset;
                    if (offset > pixPos) {
                      var repPixel = findColorForInvalidOffset(offset - pixPos);
                      while (length--) pixels[pixPos++] = repPixel;
                    }
                    else {
                      offset = pixPos - offset;
                      pixels.set(pixels.subarray(offset, offset + length), pixPos);
                      pixPos += length;
                    }
                    continue;
                  case 83:
                    var firstByte = data[dataPos++];
                    if ((firstByte & 0xC0) === 0xC0) {
                      var top4 = readBits(4);
                      var nextByte = data[dataPos++];
                      length = (firstByte & 0x3F) + 8;
                      offset = (top4 << 8) | nextByte;
                      offset = pixPos + 1 + offset;
                      pixels.set(pixels.subarray(offset, offset + length), pixPos);
                      pixPos += length;
                      continue;
                    }
                    var length, offset;
                    if (firstByte & 0x80) {
                      // read bits BEFORE read byte!
                      var top4 = readBits(4);
                      var nextByte = data[dataPos++];
                      length = 14 + (firstByte & 0x3F);
                      offset = (top4 << 8) | nextByte;
                    }
                    else {
                      var bits6To4 = firstByte >>> 4;
                      var bits3To0 = firstByte & 0xF;
                      var nextByte = data[dataPos++];
                      length = bits6To4 + 6;
                      offset = (bits3To0 << 8) | nextByte;
                    }
                    if (offset == 0xFFF) {
                      var repPixel = (pixPos === 0) ? 0xFF : pixels[pixPos-1];
                      while (length--) pixels[pixPos++] = repPixel;
                      continue;
                    }
                    offset = 4096 - offset;
                    if (offset > pixPos) {
                      var repPixel = findColorForInvalidOffset(offset - pixPos);
                      while (length--) pixels[pixPos++] = repPixel;
                    }
                    else {
                      offset = pixPos - offset;
                      pixels.set(pixels.subarray(offset, offset + length), pixPos);
                      pixPos += length;
                    }
                    continue;
                  default:
                    console.error('unknown packed mode');
                    return;
                }
              }
              switch (header.encoding) {
                case 0: // new palette
                case 1: // new palette, fill with color 0
                  newFrame.palette = new Uint8Array(256 * 4);
                  for (var i = 0; i < 256; i++) {
                    var r = data[i*3] || 0;
                    var g = data[i*3 + 1] || 0;
                    var b = data[i*3 + 2] || 0;
                    r = (r << 2) | (r >>> 4);
                    g = (g << 2) | (g >>> 4);
                    b = (b << 2) | (b >>> 4);
                    newFrame.palette[i*4] = r;
                    newFrame.palette[i*4 + 1] = g;
                    newFrame.palette[i*4 + 2] = b;
                    newFrame.palette[i*4 + 3] = 0xff;
                  }
                  newFrame.palette = new Uint32Array(
                    newFrame.palette.buffer, newFrame.palette.byteOffset, 256);
                  if (header.encoding !== 0) {
                    newFrame.pix8 = new Uint8Array(newFrame.pix8.length);
                  }
                  if (header.isShown) redraw();
                  break;
                case 3:
                  // do nothing!
                  break;
                case 6:
                case 8:
                  try {
                    readPacked();
                  }
                  catch (e) {
                    console.error(e);
                  }
                  if (header.isShown) redraw();
                  break;
                default:
                  console.error('unknown encoding: ' + header.encoding);
                  break;
              }
              return newFrame;
            }
            function pullFrames(n) {
              while (n-- > decodedFrameQueue.length) {
                if (frames.length === 0) return;
                var frame = frames.shift();
                decodedFrameQueue.push(lastFrame = Promise.all([lastFrame, frame.header, frame.readAllBytes()]).then(decode));
              }
            }
            function onAnimationFrame() {
              reqId = requestAnimationFrame(onAnimationFrame);
              if (ac.currentTime < nextFrameTime) {
                return;
              }
              if (ac.currentTime >= endTime) {
                cancelAnimationFrame(reqId);
                reqId = null;
                section.dispatchEvent(new CustomEvent('stopped'));
                return;
              }
              nextFrameTime += 1/header.framesPerSecond;
              if (!header.videoIsPresent) return;
              pullFrames(5);
              decodedFrameQueue.shift().then(function(frame) {
                section.ctx2d.putImageData(frame.imageData, 0, 0);
              });
            }
            pullFrames(5);
            onAnimationFrame();
          });
        });
        section.buttons.appendChild(section.playButton = document.createElement('BUTTON'));
        section.playButton.innerText = 'Play';
        section.playButton.onclick = function() {
          section.dispatchEvent(new CustomEvent('play'));
          section.playButton.disabled = true;
        };
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
        
        if (header.audioIsPresent) {
          section.buttons.appendChild(section.downloadWavButton = document.createElement('BUTTON'));
          section.downloadWavButton.innerText = 'Download .WAV';
          section.downloadWavButton.onclick = function() {
            section.downloadWavButton.disabled = true;
            gdv.getWav().then(function(blob) {
              var link = document.createElement('A');
              link.setAttribute('href', URL.createObjectURL(blob));
              link.setAttribute('download', (file.name || 'gdv').replace(/\..*/, '') + '.wav');
              document.body.appendChild(link);
              link.onclick = function() {
                link.parentNode.removeChild(link);
                section.downloadWavButton.disabled = false;
              };
              link.click();
            });
          };
        }
        
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
