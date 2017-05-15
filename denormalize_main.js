requirejs.config({
  waitSeconds: 0,
});

define([],
function() {

  'use strict';
  
  var ac = new AudioContext();
  
  const LITTLE_ENDIAN = (new Uint16Array(new Uint8Array([1, 0]).buffer)[0] === 1);
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
  
  function deMGL(blob) {
    return blob.readAllBytes().then(function(bytes) {
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
      buf = buf.subarray(0, out_i);
      var type = '';
      if (String.fromCharCode.apply(null, buf.slice(0, 6)) === 'DASP\x05\x00') {
        type = 'application/x-das';
      }
      return new Blob([buf], {type:type});
    });
  }
  
  var dpcmDeltaTable = (function() {
    var deltaTable = new Int16Array(256);
    var delta = 0, code = 64, step = 45;
    for (var i = 1; i < 255; i += 2) {
      delta += code >>> 5;
      code += step;
      step += 2;
      deltaTable[i] = delta;
      deltaTable[i+1] = -delta;
    }
    deltaTable[255] = delta + (code >>> 5);
    return deltaTable;
  })(); 
  
  function decodeDPCM(dpcm) {
    var state = new Int16Array(2);
    var samples = new Int16Array(dpcm.length);
    for (var sample_i = 0; sample_i < samples.length; sample_i++) {
      samples[sample_i] = state[sample_i & 1] += dpcmDeltaTable[dpcm[sample_i]];
    }
    samples = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    if (!LITTLE_ENDIAN) {
      for (var i = 0; i < samples.length; i += 2) {
        // 16-bit endian swap
        samples[i] ^= samples[i+1];
        samples[i+1] ^= samples[i];
        samples[i] ^= samples[i+1];
      }
    }
    return samples;
  }
  
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
    get unpackedAudioChunkSize() {
      if (!this.audioIsPresent) return 0;
      var size = Math.floor(this.sampleRate / this.framesPerSecond);
      size *= this.audioChannels;
      size *= this.audioBytesPerSample;
      Object.defineProperty(this, 'unpackedAudioChunkSize', {value:size, enumerable:true});
      return size;
    },
    get packedAudioChunkSize() {
      if (!this.audioIsPresent) return 0;
      if (this.audioIsDPCM) return this.unpackedAudioChunkSize / this.audioBytesPerSample;
      return this.unpackedAudioChunkSize;
    },
  };
  GDVFileHeader.byteLength = 24;
  
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
    getClearColor: function(bitsPerPixel) {
      return this.flags >>> 24;
      //if (bitsPerPixel !== 8 || !(this.flags >>> 8)) return 0;
      //return 0xff;
    },
  };
  GDVFrameHeader.byteLength = 8;
  
  const FRAME_BLOCK_MAX_SIZE = 256 * 1024;
  
  function readPalette(bytes) {
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
  }
  
  function GDV(fileHeader, initialPalette, frameBlocks) {
    this.fileHeader = fileHeader;
    this.initialPalette = initialPalette;
    this.frameBlocks = frameBlocks;
  }
  GDV.prototype = {
    createSampleReader: function() {
      if (!this.fileHeader.audioIsPresent) {
        return function() { return null; };
      }
      if (!this.fileHeader.audioIsDPCM) {
        return function(samples) {
          return samples;
        };
      }
      const state = new Int16Array(2);
      return function(samples) {
        var dv = new DataView(new ArrayBuffer(samples.length * 2));
        for (var i = 0; i < samples.length; i++) {
          dv.setInt16(i*2, state[i&1] += dpcmDeltaTable[samples[i]], true);
        }
        return new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
      };
    },
    readBlock: function(i) {
      return this.frameBlocks[i].readArrayBuffer();
    },
    eachFrameInBlockBuffer: function(buffer, cb) {
      var audioSize = this.fileHeader.packedAudioChunkSize;
      var hasVideo = this.fileHeader.videoIsPresent;
      var pos = 0;
      do {
        var audioChunk = new Uint8Array(buffer, pos, audioSize);
        pos += audioSize;
        var videoHeader, videoData;
        if (hasVideo) {
          videoHeader = new GDVFrameHeader(buffer, pos, GDVFrameHeader.byteLength);
          videoData = new Uint8Array(buffer, pos + GDVFrameHeader.byteLength, videoHeader.dataByteLength);
          pos += GDVFrameHeader.byteLength + videoData.length;
        }
        else videoHeader = videoData = null;
        if (cb(audioChunk, videoHeader, videoData) === 'break') return 'break';
      } while (pos < buffer.byteLength);
      return 'complete';
    },
    eachFrameInEveryBlock: function(cb) {
      var frameBlocks = this.frameBlocks;
      if (frameBlocks.length === 0) return Promise.resolve('complete');
      var self = this;
      function doBlock(next_i, buffer) {
        var readingNext = (next_i < frameBlocks.length) ? self.readBlock(next_i) : null;
        if (self.eachFrameInBlockBuffer(buffer, cb) === 'break') return 'break';
        if (readingNext) return readingNext.then(doBlock.bind(null, next_i+1));
        return 'complete';
      }
      return this.readBlock(0).then(doBlock.bind(null, 1));
    },
    getAudioDataBlob: function() {
      var frameBlocks = this.frameBlocks;
      if (frameBlocks.length === 0 || !this.fileHeader.audioIsPresent) return null;
      var readSamples = this.createSampleReader();
      var self = this;
      var sampleBlobs = [];
      function doBlock(next_i, buffer) {
        var readingNext = (next_i < frameBlocks.length) ? self.readBlock(next_i) : null;
        var samples = [];
        self.eachFrameInBlockBuffer(buffer, function(audioChunk) {
          samples.push(readSamples(audioChunk));
        });
        sampleBlobs.push(new Blob(samples));
        if (readingNext) return readingNext.then(doBlock.bind(null, next_i+1));
        return new Blob(sampleBlobs);
      }
      return this.readBlock(0).then(doBlock.bind(null, 1));
    },
    getWavBlob: function() {
      var fileHeader = this.fileHeader;
      return this.getAudioDataBlob().then(function(audioDataBlob) {
        if (!audioDataBlob) return null;
        
        var fmt = new DataView(new ArrayBuffer(20));
        fmt.setUint32(0, 16, true);
        fmt.setUint16(4, 1, true);
        fmt.setUint16(6, fileHeader.audioChannels, true);
        fmt.setUint32(8, fileHeader.sampleRate, true);
        fmt.setUint32(12, fileHeader.sampleRate * fileHeader.audioChannels * fileHeader.audioBytesPerSample, true);
        fmt.setUint16(16, fileHeader.audioChannels * fileHeader.audioBytesPerSample, true);
        fmt.setUint16(18, fileHeader.audioBytesPerSample * 8, true);
        
        var fileSize = new DataView(new ArrayBuffer(4));
        fileSize.setUint32(0, 36 + audioDataBlob.size, true);
        
        var dataSize = new DataView(new ArrayBuffer(4));
        dataSize.setUint32(0, audioDataBlob.size, true);
        
        return new Blob(
          ['RIFF', fileSize, 'WAVE', 'fmt ', fmt, 'data', dataSize, audioDataBlob],
          {type: 'audio/wav'}
        );
      });
    },
    get durationString() {
      var seconds = Math.ceil(this.fileHeader.frameCount / this.fileHeader.framesPerSecond);
      var minutes = (seconds / 60) | 0;
      seconds = (seconds % 60) | 0;
      return ('0' + minutes).slice(-2) + ':' + ('0' + seconds).slice(-2);
    },
    createVideoDisplay: function() {
      if (!this.fileHeader.videoIsPresent) return null;
      var display = document.createElement('CANVAS');
      display.width = this.fileHeader.videoWidth;
      display.height = this.fileHeader.videoHeight;
      display.ctx2d = display.getContext('2d');
      var pal0 = new Uint8Array(this.initialPalette.buffer, this.initialPalette.byteOffset, 3);
      display.ctx2d.fillStyle = 'rgb(' + [].join.call(pal0, ',') + ')';
      display.ctx2d.fillRect(0, 0, display.width, display.height);
      display.initialFrame = {
        palette: this.initialPalette,
        pix8: new Uint8Array(display.width * display.height),
        imageData: display.ctx2d.getImageData(0, 0, display.width, display.height),
      };
      return display;
    },
    decode: function(prevFrame, header, data) {
      var newFrame = {
        palette: prevFrame.palette,
        pix8: prevFrame.pix8,
        imageData: prevFrame.imageData,
      };
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
        if (header.halfResMode) {
          const lineSize = newFrame.imageData.width;
          for (var pos = lineSize*2; pos < pixels.length; pos += lineSize*2) {
            pixels.set(pixels.subarray(pos, pos + lineSize), pos >>> 1);
          }
        }
        if (header.quarterResMode) {
          for (var pos = 2; pos < pixels.length; pos += 2) {
            pixels[pos >> 1] = pixels[pos];
          }
        }
        return pixels;
      }
      function finalizePixels(pixels) {
        if (header.quarterResMode) {
          for (var pos = pixels.length/2 - 1; pos > 0; pos--) {
            pixels[pos << 1] = pixels[(pos << 1) + 1] = pixels[pos];
          }
        }
        if (header.halfResMode) {
          const lineSize = newFrame.imageData.width;
          for (var pos = pixels.length/2 - lineSize; pos > 0; pos -= lineSize) {
            var sub = pixels.subarray(pos, pos + lineSize);
            pixels.set(sub, pos << 1);
            pixels.set(sub, (pos << 1) + lineSize);
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
                var repPixel = (pixPos === 0) ? header.getClearColor(8) : pixels[pixPos-1];
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
              var repPixel = (pixPos === 0) ? header.getClearColor(8) : pixels[pixPos-1];
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
                var repPixel = (pixPos === 0) ? header.getClearColor(8) : pixels[pixPos-1];
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
              var repPixel = (pixPos === 0) ? header.getClearColor(8) : pixels[pixPos-1];
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
        case 1: // new palette, clear to color 0 or 0xff
          newFrame.palette = readPalette(data);
          if (header.encoding === 1) {
            newFrame.pix8 = new Uint8Array(newFrame.pix8.length);
            var clearColor = header.getClearColor(8);
            if (clearColor !== 0) for (var i = 0; i < newFrame.pix8.length; i++) {
              newFrame.pix8[i] = clearColor;
            }
          }
          break;
        case 3:
          // do nothing!
          break;
        case 5:
          var pixels = initPixels(newFrame.pix8);
          var pixPos = header.offset;
          var dataPos = 0;
          decoding: for (;;) {
            var twiddles = data[dataPos++];
            var rshift = 6;
            do switch ((twiddles >>> rshift) & 3) {
              case 0:
                pixels[pixPos++] = data[dataPos++];
                continue;
              case 1:
                var byte_a = data[dataPos++];
                var byte_b = data[dataPos++];
                var length = (byte_a & 0x0F) + 3;
                var offset = ((byte_a & 0xF0) << 4) | byte_b;
                if (offset === 0xFFF) {
                  var repPixel = (pixPos === 0) ? header.getClearColor(8) : pixels[pixPos-1];
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
              case 2:
                var length = data[dataPos++];
                if (length === 0) {
                  // end of stream
                  break decoding;
                }
                if (length === 0xFF) {
                  length = data[dataPos++];
                  length |= data[dataPos++] << 8;
                }
                pixPos += length;
                continue;
              case 3:
                var byte = data[dataPos++];
                var offset = byte >> 2, length = (byte & 0x03) + 2;
                if (offset === 0) {
                  var repPixel = pixPos === 0 ? header.getClearColor(8) : pixels[pixPos-1];
                  while (length--) pixels[pixPos++] = repPixel;
                  continue;
                }
                offset--;
                if (offset > pixPos) {
                  var repPixel = findColorForInvalidOffset(offset - pixPos);
                  while (length--) pixels[pixPos++] = repPixel;
                  continue;
                }
                offset = pixPos - offset;
                pixels.set(pixels.subarray(offset, offset + length), pixPos);
                pixPos += length;
                continue;
            } while ((rshift -= 2) >= 0);
          }
          newFrame.pix8 = finalizePixels(pixels);
          break;
        case 6:
        case 8:
          try {
            readPacked();
          }
          catch (e) {
            console.error(e);
          }
          break;
        default:
          console.error('unknown encoding: ' + header.encoding);
          break;
      }
      return newFrame;
    },
    createAudioSourceFactory: function(destination) {
      var fileHeader = this.fileHeader;
      if (!fileHeader.audioIsPresent) return function(){};
      var audioContext = destination.context;
      var readSamples = this.createSampleReader();
      var copySamples;
      switch (fileHeader.audioBytesPerSample) {
        case 1:
          copySamples = function(channels, bytes) {
            for (var i = 0; i < bytes.length; i++) {
              channels[i % channels.length][(i / channels.length)|0] = (bytes[i] - 128) / 128;
            }
          };
          break;
        case 2:
          if (LITTLE_ENDIAN) copySamples = function(channels, bytes) {
            var shorts = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length/2);
            for (var i = 0; i < shorts.length; i++) {
              channels[i % channels.length][(i / channels.length)|0] = shorts[i] / 32768;
            }
          };
          else copySamples = function(channels, bytes) {
            var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
            for (var i = 0; i < bytes.length/2; i++) {
              channels[i % channels.length][(i / channels.length)|0] = dv.getInt16(i*2, true) / 32768;
            }
          };
          break;
        default: throw new Error('unsupported format');
      }
      return function(samples, time) {
        samples = readSamples(samples);
        var abuffer = audioContext.createBuffer(
          fileHeader.audioChannels,
          samples.length / (fileHeader.audioChannels * fileHeader.audioBytesPerSample),
          fileHeader.sampleRate);
        var channels = new Array(fileHeader.audioChannels);
        for (var i = 0; i < channels.length; i++) {
          channels[i] = abuffer.getChannelData(i);
        }
        copySamples(channels, samples);
        var asource = audioContext.createBufferSource();
        asource.buffer = abuffer;
        asource.connect(destination);
        asource.start(time);
      };
    },
    play: function(audioContext, display) {
      var destination = audioContext.createGain();
      destination.connect(audioContext.destination);
      var frameBlocks = this.frameBlocks;
      if (frameBlocks.length === 0) return Promise.resolve('complete');
      var audioSource = this.createAudioSourceFactory(destination);
      var self = this;
      var frameQueue = [];
      var frame = display.initialFrame;
      var frameSeconds = 1/this.fileHeader.framesPerSecond;
      var animId = null;
      var nextBlockId = null;
      function updateAnim() {
        animId = requestAnimationFrame(updateAnim);
        if (frameQueue.length === 0 || frameQueue[0].time > audioContext.currentTime) {
          return;
        }
        var frame = frameQueue.shift();
        display.ctx2d.putImageData(frame.imageData, 0, 0);
        if (frame.last) {
          cancelAnimationFrame(animId);
          animId = null;
        }
      }
      function doBlock(next_i, startTime, buffer) {
        var time = startTime;
        var readingNext = (next_i < frameBlocks.length) ? self.readBlock(next_i) : null;
        self.eachFrameInBlockBuffer(buffer, function(audioChunk, videoHeader, videoData) {
          frameQueue.push(frame = self.decode(frame, videoHeader, videoData));
          frame.time = time;
          if (videoHeader.isShown) {
            frame.imageData = display.ctx2d.createImageData(display.width, display.height);
            var pix32 = new Uint32Array(
              frame.imageData.data.buffer,
              frame.imageData.data.byteOffset, 
              frame.imageData.data.byteLength/4);
            var pix8 = frame.pix8, palette = frame.palette;
            for (var i = 0; i < pix32.length; i++) {
              pix32[i] = palette[pix8[i]];
            }
          }
          audioSource(audioChunk, time);
          time += frameSeconds;
        });
        if (readingNext) {
          var scheduleNext = startTime - audioContext.currentTime;
          if (scheduleNext <= 0) {
            return readingNext.then(doBlock.bind(null, next_i+1, time));
          }
          return Promise.all([readingNext, new Promise(function(resolve, reject) {
            nextBlockId = setTimeout(function() {
              nextBlockId = null;
              resolve();
            }, scheduleNext * 1000);
          })])
          .then(function(values) {
            return doBlock(next_i+1, time, values[0]);
          });
        }
        frameQueue[frameQueue.length-1].last = true;
        return 'complete';
      }
      var promise = this.readBlock(0).then(function(buffer) {
        if (display) animId = requestAnimationFrame(updateAnim);
        doBlock(1, audioContext.currentTime, buffer);
      });
      promise.stop = function() {
        destination.disconnect();
        if (animId !== null) {
          cancelAnimationFrame(animId);
          animId = null;
        }
        if (nextBlockId !== null) {
          clearTimeout(nextBlockId);
          nextBlockId = null;
        }
      };
      return promise;
    },
    get audioIsPresent() { return this.fileHeader.audioIsPresent; },
    get videoIsPresent() { return this.fileHeader.videoIsPresent; },
  };
  GDV.read = function(blob) {
    var fileHeader = null, initialPalette = null, frameBlocks = [];
    var pos = 0;
    function readBlocksFrom(offset) {
      if (offset >= blob.size) {
        return new GDV(fileHeader, initialPalette, frameBlocks);
      }
      return blob.slice(offset, Math.min(offset + FRAME_BLOCK_MAX_SIZE, blob.size))
      .readArrayBuffer().then(function(buffer) {
        var bytes = new Uint8Array(buffer), startPos = 0, pos = 0;
        if (offset === 0) {
          fileHeader = new GDVFileHeader(buffer, 0, GDVFileHeader.byteLength);
          pos += GDVFileHeader.byteLength;
          if (fileHeader.bitsPerPixel === 8) {
            initialPalette = readPalette(new Uint8Array(buffer, pos, 256 * 3));
            pos += 256 * 3;
          }
          if (!fileHeader.videoIsPresent && !fileHeader.audioIsPresent) {
            return readBlock(blob.size);
          }
          startPos = pos;
        }
        var audioSize = fileHeader.packedAudioChunkSize;
        do {
          var videoSize = 0;
          if (fileHeader.videoIsPresent) {
            videoSize += GDVFrameHeader.byteLength;
            if ((pos + audioSize + videoSize) > bytes.length) break;
            var frameHeader = new GDVFrameHeader(buffer, pos + audioSize, GDVFrameHeader.byteLength);
            if (!frameHeader.hasValidSignature) {
              return Promise.reject('invalid video frame');
            }
            videoSize += frameHeader.dataByteLength;
          }
          if ((pos + audioSize + videoSize) > bytes.length) break;
          pos += audioSize + videoSize;
        } while (pos < bytes.length);
        var frameBlock = blob.slice(offset + startPos, offset + pos);
        frameBlocks.push(frameBlock);
        return readBlocksFrom(offset + pos);
      });
    }
    return readBlocksFrom(0);
  };
  
  function DASFileHeader(buffer, byteOffset, byteLength) {
    this.bytes = new Uint8Array(buffer, byteOffset, byteLength);
    this.dv = new DataView(buffer, byteOffset, byteLength);
  }
  DASFileHeader.prototype = {
    get signature() {
      return String.fromCharCode.apply(null, this.bytes.subarray(0, 6));
    },
    get hasValidSignature() {
      return this.signature === 'DASP\x05\x00';
    },
    get imageRecordsOffset() {
      return this.dv.getUint32(8, true);
    },
    get imageRecordsByteLength() {
      return this.dv.getUint16(6, true);
    },
    get paletteOffset() {
      return this.dv.getUint32(12, true);
    },
    // uint32_t
    get namesOffset() {
      return this.dv.getUint32(20, true);
    },
    get namesByteLength() {
      return this.dv.getUint32(24, true);
    },
    // uint32_t
    // uint32_t
  };
  DASFileHeader.byteLength = 36;
  
  function DASNameRecord(buffer, byteOffset, byteLength) {
    var dv = new DataView(buffer, byteOffset, byteLength);
    this.unknown1 = dv.getUint16(0, true);
    this.index = dv.getUint16(2, true);
    var bytes = new Uint8Array(buffer, byteOffset, byteLength);
    var offset = 4;
    var startOffset = offset;
    while (bytes[offset] !== 0) offset++;
    this.shortName = String.fromCharCode.apply(null, bytes.subarray(startOffset, offset));
    offset = startOffset = offset + 1;
    while (bytes[offset] !== 0) offset++;
    this.longName = String.fromCharCode.apply(null, bytes.subarray(startOffset, offset));
    this.byteLength = ++offset;
  }
  
  function DASNamesSection(buffer, byteOffset, byteLength) {
    this.dv = new DataView(buffer, byteOffset, byteLength);
  }
  DASNamesSection.prototype = {
    get textureCount() {
      return this.dv.getUint16(0, true);
    },
    get spriteCount() {
      return this.dv.getUint16(2, true);
    },
    get records() {
      var list = new Array(this.textureCount + this.spriteCount);
      var buffer = this.dv.buffer, byteOffset = this.dv.byteOffset + 4, byteLength = this.dv.byteLength - 4;
      for (var i = 0; i < list.length; i++) {
        var record = list[i] = new DASNameRecord(buffer, byteOffset, byteLength);
        byteOffset += record.byteLength;
        byteLength -= record.byteLength;
      }
      Object.defineProperty(this, 'records', {value:list, enumerable:true});
      return list;
    },
  };
  
  function DASAnimation(buffer, byteOffset, byteLength) {
    this.dv = new DataView(buffer, byteOffset, byteLength);
  }
  DASAnimation.prototype = {
    get unknown1() {
      return this.dv.getUint32(0, true);
    },
    get byteLength() {
      return this.dv.getUint16(4, true);
    },
    get unknown2() {
      return this.dv.getUint16(6, true);
    },
    // 3 bytes always 0xFFFFFF
    get speed() {
      return this.dv.getUint8(11, true);
    },
    get deltaOffsets() {
      var list = new Array((this.byteLength - 20)/4);
      for (var i = 0; i < list.length; i++) {
        list[i] = this.dv.getUint32(12 + i*4, true);
        if (list[i] !== 0) list[i] += 4;
      }
      Object.defineProperty(this, 'deltaOffsets', {value:list, enumerable:true});
      return list;
    },
    get unknown3() {
      return this.dv.getUint32(this.byteLength - 8, true);
    },
    get unknown4() {
      return this.dv.getUint32(this.byteLength - 4, true);
    },
  };
  
  function DASImageHeader(buffer, byteOffset, byteLength) {
    this.dv = new DataView(buffer, byteOffset, byteLength);
  }
  DASImageHeader.prototype = {
    get flags() {
      return this.dv.getUint16(0, true);
    },
    get isAnimated() {
      return !!(this.flags & 0x100);
    },
    get width() {
      return this.dv.getUint16(2, true);
    },
    get height() {
      return this.dv.getUint16(4, true);
    },
    get animation() {
      if (!this.isAnimated) return null;
      var anim = new DASAnimation(this.dv.buffer, this.dv.byteOffset + 6, this.dv.byteLength - 6);
      Object.defineProperty(this, 'animation', {value:anim, enumerable:true});
      return anim;
    },
    get byteLength() {
      return 6 + (this.isAnimated ? this.animation.byteLength : 0);
    },
  };
  
  function DASImage(das, nameRecord, offset, unknown) {
    this.das = das;
    this.blob = das.blob;
    this.nameRecord = nameRecord;
    this.offset = offset;
    this.unknown = unknown;
  }
  DASImage.prototype = {
    get kind() {
      return (this.nameRecord.index >= 0x1000) ? 'sprite' : 'texture';
    },
    get index() {
      return (this.nameRecord.index & 0xfff);
    },
    get retrievedHeader() {
      var self = this, blob = this.blob, header;
      var promise = blob.readBuffered(this.offset, Math.min(blob.size, this.offset + 14))
      .then(function(headerBytes) {
        var tempHeader = new DASImageHeader(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
        return blob.readBuffered(self.offset, self.offset + tempHeader.byteLength);
      })
      .then(function(headerBytes) {
        return new DASImageHeader(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
      });
      Object.defineProperty(this, 'retrievedHeader', {value:promise, enumerable:true});
      return promise;
    },
    getFirstFrame: function() {
      var self = this, blob = this.blob;
      var palette, header;
      return Promise.all([this.das.retrievedPalette, this.retrievedHeader])
      .then(function(values) {
        palette = values[0];
        header = values[1];
        return blob.readBuffered(
          self.offset + header.byteLength,
          self.offset + header.byteLength + header.width * header.height);
      });
    },
  };
  
  function DAS(blob, fileHeader, offsetRecords, nameSection) {
    this.blob = blob;
    this.fileHeader = fileHeader;
    
    var imageRecords = this.imageRecords = [];
    var imageRecordsByIndex = this.imageRecordsByIndex = {};
    var self = this;
    nameSection.records.forEach(function(record) {
      var offset = offsetRecords[record.index*2];
      if (!offset) return;
      imageRecords.push(imageRecordsByIndex[record.index] = new DASImage(
        self,
        record,
        offset,
        offsetRecords[record.index*2 + 1]));
    });
    for (var i = 0; i < imageRecords.length/2; i++) {
      var offset = offsetRecords[i*2];
      if (offset && !(i in imageRecordsByIndex)) {
        imageRecords.push(imageRecordsByIndex[i] = new DASImage(
          self,
          {shortName:'', longName:''},
          offset,
          offsetRecords[i*2 + 1]));
      }
    }
    imageRecords.sort(function(a, b) {
      return a.offset - b.offset;
    });
  }
  DAS.prototype = {
    /*
    getPalette: function() {
      function loadImageBlock(block) {
        var dv = new DataView(block.buffer, block.byteOffset, block.byteLength);
        var list = new Array(block.byteLength/8);
        for (var i = 0; i < list.length; i++) {
          list[i] = {
            offset: dv.getUint32(i*8, true),
            unknown: dv.getUint32(i*8 + 4, true),
          };
          if (list[i].offset === 0) list[i] = null;
        }
        return list;
      }
      function readImage(values) {
        var info = values[1], data = values[2];
      }
      var nameSection = this.nameSection;
      var maxTextureIndex = 0, maxSpriteIndex = 0;
      nameSection.records.forEach(function(record) {
        switch (record.kind) {
          case 'texture':
            maxTextureIndex = Math.max(maxTextureIndex, record.index);
            break;
          case 'sprite':
            maxSpriteIndex = Math.max(maxSpriteIndex, record.index);
            break;
        }
      });
      var readTextureBlock = blob.readBuffered(
        fileHeader.textureRecordsOffset,
        fileHeader.textureRecordsOffset + 8 + 8 * maxTextureIndex);
      var readSpriteBlock = blob.readBuffered(
        fileHeader.spriteRecordsOffset,
        fileHeader.spriteRecordsOffset + 8 + 8 * maxSpriteIndex);
      return Promise.all([
        readTextureBlock.then(loadImageBlock),
        readSpriteBlock.then(loadImageBlock),
      ]);
    })
    .then(function(values) {
      var textures = values[0], sprites = values[1];
      var combo = [];
      for (var i = 0; i < textures.length; i++) {
        if (!textures[i]) continue;
        combo.push({kind:'texture', index:i, offset:textures[i].offset});
      }
      for (var i = 0; i < sprites.length; i++) {
        if (!sprites[i]) continue;
        combo.push({kind:'sprite', index:i, offset:sprites[i].offset});
      }
      combo.sort(function(a,b) { return a.offset - b.offset; });
      var slices = new Array(combo.length);
      for (var i = 0; i < slices.length-1; i++) {
        slices[i] = Promise.all([
          combo[i],
          blob.readBuffered(combo[i].offset, combo[i+1].offset),
        ]).then(readImage);
      }
      slices[i] = Promise.all([
        combo[i],
        blob.readBuffered(combo[i].offset, blob.size),
      ]).then(readImage);
      return Promise.all(slices);
    },
    */
  };
  DAS.read = function(blob) {
    var fileHeader;
    return blob.readBuffered(0, DASFileHeader.byteLength).then(function(headerBytes) {
      fileHeader = new DASFileHeader(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
      var gotImageRecords = blob.readBuffered(
        fileHeader.imageRecordsOffset,
        fileHeader.imageRecordsOffset + fileHeader.imageRecordsByteLength)
      .then(function(imageRecords) {
        if (LITTLE_ENDIAN && !(imageRecords.byteOffset & 3)) {
          return new Uint32Array(imageRecords.buffer, imageRecords.byteOffset, imageRecords.byteLength/4);
        }
        var dv = new DataView(imageRecords.buffer, imageRecords.byteOffset, imageRecords.byteLength);
        var uints = new Uint32Array(imageRecords.byteLength/4);
        for (var i = 0; i < uints.length; i++) {
          uints[i] = dv.getUint32(i*4, true);
        }
        return uints;
      });
      var gotNamesSection = blob.slice(
        fileHeader.namesOffset,
        fileHeader.namesOffset + fileHeader.namesByteLength)
      .readArrayBuffer().then(function(ab) {
        return new DASNamesSection(ab, 0, ab.byteLength);
      });
      return Promise.all([gotImageRecords, gotNamesSection]).then(function(values) {
        var imageRecords = values[0], namesSection = values[1];
        return new DAS(
          blob,
          fileHeader,
          imageRecords,
          namesSection);
      });
    });
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
      GDV.read(file).then(function(gdv) {
        section.titleElement.innerText += ' (' + gdv.durationString + ')';
        var lastFrame;
        if (gdv.fileHeader.videoIsPresent) {
          section.appendChild(section.display = gdv.createVideoDisplay());
        }
        section.addEventListener('play', function() {
          var playing = gdv.play(ac, section.display);
          section.addEventListener('stop', playing.stop.bind(playing));
          section.dispatchEvent(new CustomEvent('playing'));
          playing.then(function() {
            section.dispatchEvent(new CustomEvent('stopped'));
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
        
        if (gdv.audioIsPresent) {
          section.buttons.appendChild(section.downloadWavButton = document.createElement('BUTTON'));
          section.downloadWavButton.innerText = 'Download .WAV';
          section.downloadWavButton.onclick = function() {
            section.downloadWavButton.disabled = true;
            gdv.getWavBlob().then(function(blob) {
              return blob.download((file.name || 'gdv').replace(/\..*/, '') + '.wav');
            })
            .then(function() {
              section.downloadWavButton.disabled = false;
            });
          };
        }
        
      });
    }
    else if (/\.mgl$/i.test(file.name)) {
      deMGL(file).then(
        function(file2) {
          if (file2.type === 'application/x-das') {
            file2.name = file.name.replace(/\..*$/, '.DAS');
            onfile(file2);
          }
          else {
            console.log(file2);
          }
        },
        function(msg) {
          section.classList.add('error');
          section.innerText = msg;
        });
    }
    else if (/\.das$/i.test(file.name)) {
      DAS.read(file).then(function(das) {
        section.appendChild(section.images = document.createElement('DIV'));

        section.images.classList.add('gallery');

        function span(className, text) {
          var span = document.createElement('SPAN');
          span.className = className;
          span.innerText = text;
          return span;
        }

        section.insertBefore(section.images.head = document.createElement('H3'), section.images);
        section.images.head.appendChild(section.images.nameSpan = span('name', 'Images'));
        section.images.head.appendChild(section.images.countSpan = span('count', das.imageRecords.length));

        function createSorter(subsection) {
          subsection.head.appendChild(document.createTextNode(' '));
          subsection.head.appendChild(subsection.sorter = document.createElement('SELECT'));
          var options = [
            {value:'index', text:'Index'},
            //{value:'shortName', text:'Short Name'},
            //{value:'longName', text:'Long Name'},
            {value:'log2h', text:'Size', selected:true},
          ];
          for (var i = 0; i < options.length; i++) {
            var option = document.createElement('OPTION');
            option.value = '+' + options[i].value;
            option.text = String.fromCharCode(0x2191) + ' ' + options[i].text;
            subsection.sorter.appendChild(option);

            var option = document.createElement('OPTION');
            option.value = '-' + options[i].value;
            option.text = String.fromCharCode(0x2193) + ' ' + options[i].text;
            if (options[i].selected) option.selected = true;
            subsection.sorter.appendChild(option);
          }
          subsection.sorter.onchange = function(e) {
            var multiply = +(this.value.slice(0, 1) + '1');
            var dataField = this.value.slice(1);
            for (var i = 0; i < subsection.children.length; i++) {
              subsection.children[i].style.order = multiply * subsection.children[i].dataset[dataField];
            }
          };
        }

        createSorter(section.images);

        function addImage(image) {
          var el = document.createElement('DIV');
          el.className = 'gallery-item kind-' + image.kind;
          el.dataset.index = image.nameRecord.index;
          el.dataset.shortName = image.nameRecord.shortName;
          el.dataset.longName = image.nameRecord.longName;
          el.setAttribute('title', [
            image.kind.slice(0,1).toUpperCase()
            + image.kind.slice(1)
            + ' ' + image.index
            + ': ' + el.dataset.shortName,
            el.dataset.longName,
          ].join('\n'));
          
          el.appendChild(el.image = document.createElement('DIV'));
          el.image.style.background = 'hsl(' + Math.random()*360 + ', 80%, 70%)';
          
          el.appendChild(el.shortNameSpan = document.createElement('DIV'));
          el.shortNameSpan.innerText = el.dataset.shortName;
          el.shortNameSpan.className = 'short-name';
          
          el.appendChild(el.longNameSpan = document.createElement('DIV'));
          el.longNameSpan.innerText = el.dataset.longName;
          el.longNameSpan.className = 'long-name';
          
          this.appendChild(el);
          image.retrievedHeader.then(function(header) {
            el.image.style.width = header.width + 'px';
            el.image.style.height = header.height + 'px';
            el.dataset.width = header.width;
            el.dataset.height = header.height;
            el.dataset.log2h = Math.ceil(Math.log2(header.height));
            el.dataset.wxh = header.width * header.height;
            el.style.order = -el.dataset.log2h;
          });
        }
        
        das.imageRecords.forEach(addImage, section.images);
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
