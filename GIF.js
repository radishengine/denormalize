define(function() {

  'use strict';
  
  var GIF = {};
  
  GIF.encode = function(globalPalette, pix8s) {
    var logicalScreenDescriptor = new DataView(new ArrayBuffer(7));
    var parts = ['GIF89a', logicalScreenDescriptor];
    logicalScreenDescriptor.setUint16(0, pix8s.width || pix8s[0].width, true);
    logicalScreenDescriptor.setUint16(2, pix8s.height || pix8s[0].height, true);
    var defaultTransparent = NaN;
    if (globalPalette) {
      var b = new Uint8Array(globalPalette.buffer, globalPalette.byteOffset, globalPalette.byteLength);
      var pal = new Uint8Array(Math.pow(2, Math.ceil(Math.log2(globalPalette.length))));
      for (var i = 0; i < globalPalette.length; i++) {
        pal[i*3] = b[i*4];
        pal[i*3 + 1] = b[i*4 + 1];
        pal[i*3 + 2] = b[i*4 + 2];
      }
      logicalScreenDescriptor.setUint8(4, 0x80 | ((Math.log2(pal.length)-1) << 4));
      for (var i = 0; i < globalPalette.length; i ++) {
        if (b[i*4 + 3] === 0) {
          defaultTransparent = i;
          break;
        }
      }
      parts.push(pal);
    }
    function oneByte(n) {
      return new Uint8Array([n]);
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
          byteOffset = extPart.byteLength;
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
      var transparent = NaN;
      var b;
      if (localPalette) {
        b = new Uint8Array(localPalette.buffer, localPalette.byteOffset, localPalette.byteLength);
        for (var j = 0; j < localPalette.length; j++) {
          if (![j*4+3]) {
            transparent = j;
            break;
          }
        }
      }
      else {
        transparent = defaultTransparent;
      }
      var packed = isNaN(transparent) ? 0 : 1;
      if (pix8.replace) {
        packed |= (pix8.replace === 'previous') ? (3 << 2) : (2 << 2);
      }
      else packed |= (1 << 2);
      graphicControlExtension.setUint8(0, packed);
      graphicControlExtension.setUint16(1, pix8.duration || pix8s.duration || 100);
      if (!isNaN(transparent)) {
        graphicControlExtension.setUint8(3, transparent);
      }
      pushExtension(0xF9, graphicControlExtension);
      
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
        for (var i = 0; i < localPalette.length; i++) {
          pal[i*3] = b[i*4];
          pal[i*3 + 1] = b[i*4 + 1];
          pal[i*3 + 2] = b[i*4 + 2];
        }
        parts.push(pal);
      }
      
      var minimumCodeSize;
      var lzw = [];
      
      throw new Error('NYI');
      
      parts.push(oneByte(minimumCodeSize));
      pushChunked(lzw);
    }
    
    parts.push(oneByte(0x3B));
    
    return new Blob(parts);
  };

});
