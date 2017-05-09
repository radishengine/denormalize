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
    get audioSampleRate() {
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
  };
  
  console.log('hello... newman world');
  
  var dragdrop = document.getElementById('dragdrop');
  
  function createSection() {
    var div = document.createElement('DIV');
    div.classList.add('section');
    var button = document.createElement('BUTTON');
    button.classList.add('close_button');
    button.innerText = 'X';
    button.onclick = function() {
      div.parentNode.removeChild(div);
    };
    div.appendChild(button);
    if (dragdrop.nextSibling) {
      dragdrop.parentNode.insertBefore(div, dragdrop.nextSibling);
    }
    else {
      dragdrop.parentNode.appendChild(div);
    }
    var inside = document.createElement('DIV');
    inside.classList.add('content');
    div.appendChild(inside);
    return inside;
  }
  
  function onfile(file) {
    var section = createSection();
    if (/\.gdv$/i.test(file.name)) {
      var gdv = new GDV(file);
      gdv.retrievedHeader.then(function(header) {
        console.log(header);
        if (header.videoIsPresent) {
          section.appendChild(section.display = document.createElement('CANVAS'));
          section.display.width = header.videoWidth;
          section.display.height = header.videoHeight;
          section.ctx2d = section.display.getContext('2d');
          section.pixelBuffer = section.ctx2d.createImageData(section.display.width, section.display.height);
          section.fillStyle = 'black';
          section.drawRect(0, 0, section.display.width, section.display.height);
        }
        section.innerText = header.videoWidth + 'x' + header.videoHeight;
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
