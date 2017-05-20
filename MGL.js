define(['wasm/Memory', 'wasm/load!MGL', 'blobMethods'], function(Memory, asm) {

  'use strict';
  
  var MGL = {};
  
  function js_decode(bytes) {
    var buf = new Uint8Array(Math.pow(2, Math.ceil(Math.log2(bytes.length + 1))));
    var in_i = 0, out_i = 0;
    function ensure(out) {
      var newSize = buf.length;
      while ((out_i + out) > newSize) newSize *= 2;
      if (newSize === buf.length) return;
      var newBuf = new Uint8Array(newSize);
      newBuf.set(buf);
      buf = newBuf;
    }
    function allZero(bytes, i, j) {
      for (; i < j; i++) {
        if (bytes[i] !== 0) return false;
      }
      return true;
    }
    decoding: while (in_i < buf.length) {
      var b = bytes[in_i++];
      var offset, length, reps;
      switch (b >>> 4) {
        case 0x0:
          if (b === 0) break decoding;
          // fall through:
        case 0x1: case 0x2: case 0x3:
          length = b;
          if ((in_i + length) > bytes.length) {
            return Promise.reject('invalid MGL: not enough input');
          }
          ensure(length);
          if (!allZero(bytes, in_i, in_i + length)) {
            buf.set(bytes.subarray(in_i, in_i + length), out_i);
          }
          out_i += length;
          in_i += length;
          continue decoding;
        case 0x4:
          length = 3 + (b & 0xF);
          if (out_i < 2) {
            return Promise.reject('invalid MGL: 2-byte pattern too early');
          }
          ensure(length);
          var state = buf[out_i-1];
          var inc = state - buf[out_i-2];
          if (state === 0 && inc === 0) {
            out_i += length;
          }
          else do {
            buf[out_i] = state += inc;
            out_i++;
          } while (--length);
          continue decoding;
        case 0x5:
          length = 2 + (b & 0xF);
          if (out_i < 4) {
            return Promise.reject('invalid MGL: 2-word pattern too early');
          }
          ensure(length*2);
          var dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
          var state = dv.getUint16(out_i-2, true);
          var inc = state - dv.getUint16(out_i-4, true);
          if (state === 0 && inc === 0) {
            out_i += 2 * length;
          }
          else do {
            dv.setUint16(out_i, dv.getUint16(out_i - 2, true) + inc, true);
            out_i += 2;
          } while (--length);
          continue decoding;
        case 0x6:
          offset = 1;
          length = 1;
          reps = 3 + (b & 0xF);
          break;
        case 0x7:
          offset = 2;
          length = 2;
          reps = 2 + (b & 0xF);
          break;
        case 0x8: case 0x9: case 0xA: case 0xB:
          offset = 3 + (b & 0x3F);
          length = 3;
          reps = 1;
          break;
        case 0xC: case 0xD:
          offset = 3 + (((b & 3) << 8) | bytes[in_i++]);
          length = 4 + ((b >>> 2) & 7);
          reps = 1;
          break;
        case 0xE: case 0xF:
          offset = 3 + (((b & 0x1F) << 8) | bytes[in_i++]);
          length = 5 + bytes[in_i++];
          reps = 1;
          break;
      }
      ensure(length * reps);
      if (offset > out_i) {
        return Promise.reject('invalid MGL: too far back');
      }
      offset = out_i - offset;
      if ((offset+length) > out_i) {
        if (allZero(buf, offset, out_i)) {
          out_i += length * reps;
          continue;
        }
        var copy = buf.subarray(offset, out_i);
        do {
          var repLength = length;
          do {
            buf.set(copy, out_i);
            out_i += copy.length;
            repLength -= copy.length;
          } while (repLength >= copy.length);
          if (repLength > 0) {
            buf.set(copy.subarray(0, repLength), out_i);
            out_i += repLength;
          }
        } while (--reps);
      }
      else {
        if (allZero(buf, offset, offset + length)) {
          out_i += length * reps;
          continue decoding;
        }
        var copy = buf.subarray(offset, offset + length);
        do {
          buf.set(copy, out_i);
          out_i += length;
        } while (--reps);
      }
    }
    return buf.subarray(0, out_i);
  }
  
  function same(b1, b2) {
    if (b1.length !== b2.length) return false;
    for (var i = 0; i < b1.length; i++) {
      if (b1[i] !== b2[i]) return false;
    }
    return true;
  }
  
  MGL.decode = function deMGL(blob) {
    var pages = Math.ceil(blob.size/65536);
    var mem = new Memory({initial:pages*2});
    return Promise.all([
      blob.readAllBytes(),
      WebAssembly.instantiate(asm, {memory:{main:mem}}),
    ]).then(function(values) {
      var bytes = new Uint8Array(mem.buffer, 0, values[0].length);
      bytes.set(values[0]);
      var asm = values[1];
      var now = performance.now();
      var buf = js_decode(asm);
      console.log('slow: ' + (performance.now() - now));
      var out_offset = pages*65536;
      now = performance.now();
      var buf2_len = asm.decode(0, bytes.length, out_offset) - out_offset;
      console.log('fast: ' + (performance.now() - now));
      var buf2 = new Uint8Array(mem.buffer, out_offset, buf2_len);
      console.log('same: ' + same(buf, buf2));
      
      var type = '';
      if (String.fromCharCode.apply(null, buf.slice(0, 6)) === 'DASP\x05\x00') {
        type = 'application/x-das';
      }
      return new Blob([buf], {type:type});
    });
  };
  
  return MGL;

});
