define(function() {

  'use strict';
  
  const BUFFER_SIZE = 64 * 1024;
  
  Blob.prototype.readBuffered = function(sliceFrom, sliceTo) {
    if (sliceTo < sliceFrom) throw new RangeError('sliceTo < sliceFrom');
    var buf = this.buffer;
    if (buf && sliceFrom >= buf.bufferOffset && sliceTo <= (buf.bufferOffset + buf.byteLength)) {
      return Promise.resolve(new Uint8Array(buf, sliceFrom - buf.bufferOffset, sliceTo - sliceFrom));
    }
    var nextBuf = this.nextBuffer;
    if (nextBuf && sliceFrom >= nextBuf.bufferOffset && sliceTo <= (nextBuf.bufferOffset + nextBuf.byteLength)) {
      return nextBuf.then(function(buf) {
        return new Uint8Array(buf, sliceFrom - buf.bufferOffset, sliceTo - sliceFrom);
      });
    }
    var bufferStart = Math.floor(sliceFrom / BUFFER_SIZE) * BUFFER_SIZE;
    var bufferEnd = Math.min(this.size, Math.ceil(sliceTo / BUFFER_SIZE) * BUFFER_SIZE);
    var self = this;
    return (nextBuf = this.nextBuffer = Object.assign(new Promise(function(resolve, reject) {
      var fr = new FileReader;
      fr.onload = function() {
        var buf = this.result;
        buf.bufferOffset = bufferStart;
        self.buffer = buf;
        if (self.nextBuffer === nextBuf) delete self.nextBuffer;
        resolve(buf);
      };
      fr.onerror = function() {
        reject(this.error);
      };
      console.info('readBuffered', self, bufferStart, bufferEnd);
      fr.readAsArrayBuffer(self.slice(bufferStart, bufferEnd));
    }), {
      bufferOffset: bufferStart,
      byteLength: bufferEnd - bufferStart,
    }))
    .then(function(buf) {
      return new Uint8Array(buf, sliceFrom - bufferStart, sliceTo - sliceFrom);
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
  
  Blob.prototype.download = function(filename) {
    var link = document.createElement('A');
    link.setAttribute('href', URL.createObjectURL(this));
    link.setAttribute('download', filename || 'file.dat');
    return new Promise(function(resolve, reject) {
      document.body.appendChild(link);
      link.onclick = function() {
        link.parentNode.removeChild(link);
        resolve();
      };
      link.click();
    });
  };

});
