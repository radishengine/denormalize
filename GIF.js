define(function() {

  'use strict';
  
  const ONEBYTE_128_255 = (function() {
    var abuf = new ArrayBuffer(128);
    var arrays = new Array(128);
    for (var i = 0; i < 128; i++) {
      (arrays[i] = new Uint8Array(abuf, i, 1))[0] = 128 + i;
    }
    return arrays;
  })();
  
  function oneByte(n) {
    if (n < 128) return String.fromCharCode(n);
    return ONEBYTE_128_255[n-128];
  }
  
  var GIF = {};
  
  GIF.encode = function(globalPalette, pix8s) {
    var logicalScreenDescriptor = new DataView(new ArrayBuffer(7));
    var parts = ['GIF89a', logicalScreenDescriptor];
    var canvasWidth = pix8s.width || pix8s[0].width;
    var canvasHeight = pix8s.height || pix8s[0].height;
    logicalScreenDescriptor.setUint16(0, canvasWidth, true);
    logicalScreenDescriptor.setUint16(2, canvasHeight, true);
    var defaultTransparent = +pix8s.transparent;
    if (globalPalette) {
      var b = new Uint8Array(globalPalette.buffer, globalPalette.byteOffset, globalPalette.byteLength);
      var palSize = 1 << Math.ceil(Math.log2(globalPalette.length));
      var pal = new Uint8Array(3 * palSize);
      for (var i = 0; i < globalPalette.length; i++) {
        pal[i*3] = b[i*4];
        pal[i*3 + 1] = b[i*4 + 1];
        pal[i*3 + 2] = b[i*4 + 2];
      }
      logicalScreenDescriptor.setUint8(4, 0x80 | (Math.log2(palSize)-1));
      parts.push(pal);
    }
    function pushChunked(extParts) {
      for (var i = 0; i < extParts.length; i++) {
        var extPart = extParts[i];
        if (extPart instanceof Blob) {
          while (extPart.size > 255) {
            parts.push(oneByte(255), extPart.slice(0, 255));
            extPart = extPart.slice(255);
          }
          if (extPart.size > 0) {
            parts.push(new Uint8Array([extPart.size]), extPart);
          }
          continue;
        }
        if (typeof extPart === 'string') {
          if (!/[^\x00-\x7F]/.test(extPart)) throw new Error('NYI: Unicode characters');
          while (extPart.length > 255) {
            parts.push(oneByte(255), extPart.slice(0, 255));
            extPart = extPart.slice(255);
          }
          if (extPart.length > 0) {
            parts.push(oneByte(extPart.length), extPart);
          }
          continue;
        }
        var buffer, byteOffset, byteLength;
        if (extPart instanceof ArrayBuffer) {
          buffer = extPart;
          byteOffset = 0;
          byteLength = extPart.byteLength;
        }
        else if (ArrayBuffer.isView(extPart)) {
          buffer = extPart.buffer;
          byteOffset = extPart.byteOffset;
          byteLength = extPart.byteLength;
        }
        else {
          throw new Error('expecting Blob, ArrayBuffer/View or string');
        }
        while (byteLength > 255) {
          parts.push(oneByte(255), new Uint8Array(buffer, byteOffset, 255));
          byteOffset += 255;
          byteLength -= 255;
        }
        if (byteLength > 0) {
          parts.push(oneByte(byteLength), new Uint8Array(buffer, byteOffset, byteLength));
        }
      }
      parts.push(oneByte(0));
    }
    function pushExtension(typeCode, data) {
      parts.push(oneByte(0x21), oneByte(typeCode));
      pushChunked(data);
    }
    
    for (var i = 0; i < pix8s.length; i++) {
      var pix8 = pix8s[i];
      var graphicControlExtension = new DataView(new ArrayBuffer(4));
      var localPalette = pix8.palette;
      var transparent = ('transparent' in pix8) ? +pix8.transparent : defaultTransparent;
      var packed = isNaN(transparent) ? 0 : 1;
      if (pix8.replace) {
        packed |= (pix8.replace === 'previous') ? (3 << 2) : (2 << 2);
      }
      else packed |= (1 << 2);
      graphicControlExtension.setUint8(0, packed);
      graphicControlExtension.setUint16(1, pix8.duration || pix8s.duration || 100, true);
      if (!isNaN(transparent)) {
        graphicControlExtension.setUint8(3, transparent);
      }
      pushExtension(0xF9, [graphicControlExtension]);
      
      var imageDescriptor = new DataView(new ArrayBuffer(10));
      parts.push(imageDescriptor);
      imageDescriptor.setUint8(0, 0x2C);
      if (!isNaN(pix8.x)) imageDescriptor.setInt16(1, pix8.x, true);
      if (!isNaN(pix8.y)) imageDescriptor.setInt16(3, pix8.y, true);
      imageDescriptor.setUint16(5, pix8.width, true);
      imageDescriptor.setUint16(7, pix8.height, true);
      if (localPalette) {
        var pal = new Uint8Array(Math.pow(2, Math.ceil(Math.log2(localPalette.length))));
        imageDescriptor.setUint8(9, 0x80 | (Math.log2(pal.length)-1));
        var b = new Uint8Array(localPalette.buffer, localPalette.byteOffset, localPalette.byteLength);
        for (var i = 0; i < localPalette.length; i++) {
          pal[i*3] = b[i*4];
          pal[i*3 + 1] = b[i*4 + 1];
          pal[i*3 + 2] = b[i*4 + 2];
        }
        parts.push(pal);
      }
      
      const MAX_CODE_SIZE = 12;
      const LAST_VALID_CODE = (1 << MAX_CODE_SIZE)-1;
      var minimumCodeSize = 8;
      var clearCode = 1 << minimumCodeSize;
      var endCode = clearCode+1;
      var nextCode = clearCode+2;
      var codeSize = minimumCodeSize+1;
      var validCodeBoundary = 1 << codeSize;
      var codeTable = Object.create(null);
      for (var i = 0; i < clearCode; i++) {
        codeTable[String.fromCharCode(i)] = i;
      }
      
      var lzw = new Uint8Array(1 << (Math.ceil(Math.log2(pix8.length))));
      var pos = 0;
      
      function ensure(size) {
        size += pos;
        var newSize = lzw.length;
        if (size <= newSize) return;
        do { newSize <<= 1; } while (newSize < size);
        var expanded = new Uint8Array(newSize);
        expanded.set(lzw);
        lzw = expanded;
      }
      
      var bufferInt = 0, bufferBits = 0;
      
      function write(code) {
        bufferInt |= code << bufferBits;
        if ((bufferBits += codeSize) >= 32) {
          ensure(4);
          lzw[pos++] = bufferInt & 0xff;
          lzw[pos++] = bufferInt >>> 8;
          lzw[pos++] = bufferInt >>> 16;
          lzw[pos++] = bufferInt >>> 24;
          bufferBits -= 32;
          bufferInt = code >>> (codeSize - bufferBits);
        }
      }
      
      function flush() {
        while (bufferBits > 0) {
          ensure(1);
          lzw[pos++] = bufferInt & 0xff;
          bufferInt >>>= 8;
          bufferBits -= 8;
        }
        pushChunked([lzw.subarray(0, pos)]);
      }
      
      parts.push(oneByte(minimumCodeSize));
      
      write(clearCode);
      
      var in_i = 0;
      var indexBuffer = String.fromCharCode(pix8[in_i++]);
      while (in_i < pix8.length) {
        var k = String.fromCharCode(pix8[in_i++]);
        var buffer_k = indexBuffer + k;
        if (buffer_k in codeTable) {
          indexBuffer = buffer_k;
          continue;
        }
        if (nextCode <= LAST_VALID_CODE) {
          codeTable[buffer_k] = nextCode++;
        }
        write(codeTable[indexBuffer]);
        indexBuffer = k;
        if (nextCode >= validCodeBoundary && nextCode <= LAST_VALID_CODE) {
          codeSize += 1;
          validCodeBoundary <<= 1;
        }
      }
      
      write(codeTable[indexBuffer]);
      
      write(endCode);
      
      flush();
    }
    
    parts.push(oneByte(0x3B)); // terminator
    
    return Object.assign(new Blob(parts, {type:'image/gif'}), {
      width: canvasWidth,
      height: canvasHeight,
    });
  };
  
  return GIF;

});
