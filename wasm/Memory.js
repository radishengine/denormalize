define(function() {

  'use strict';
  
  if ('WebAssembly' in window && typeof WebAssembly.Memory === 'function') {
    return WebAssembly.Memory;
  }
  
  function WasmStyleMemory(descriptor) {
    if (!descriptor || isNaN(descriptor.initialSize) || descriptor.initialSize < 0 || !isFinite(descriptor.initialSize)) {
      throw new Error('invalid descriptor');
    }
    this.buffer = new ArrayBuffer(descriptor.initialSize * 64 * 1024);
  }
  WasmStyleMemory.prototype = {
    grow: function(byPages) {
      var oldPages = this.buffer.byteLength / (64 * 1024);
      var newPages = oldSize + Math.ceil(byPages);
      if (isNaN(newPages)) {
        throw new Error('invalid number of pages to grow by');
      }
      if (newPages > oldPages) {
        if (newPages >= (64 * 1024)) {
          throw new Error('requested memory too big (>= 4GiB)');
        }
        var newBuffer = new Uint8Array(newPages * 64 * 1024);
        newBuffer.set(new Uint8Array(this.buffer));
        this.buffer = newBuffer;
      }
      return oldPages;
    },
  };
  
  return WasmStyleMemory;
  
});
