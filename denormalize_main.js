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
          newFrame.palette = readPalette(data);
          if (header.encoding !== 0) {
            newFrame.pix8 = new Uint8Array(newFrame.pix8.length);
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
                  var repPixel = pixPos === 0 ? 0xFF : pixels[pixPos-1];
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
    play: function(audioContext, display) {
      var destination = audioContext.createGain();
      destination.connect(audioContext.destination);
      var frameBlocks = this.frameBlocks;
      if (frameBlocks.length === 0) return Promise.resolve('complete');
      var readSamples = this.createSampleReader();
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
        var samples = [];
        self.eachFrameInBlockBuffer(buffer, function(audioChunk, videoHeader, videoData) {
          frameQueue.push(frame = self.decode(frame, videoHeader, videoData));
          frame.time = time;
          time += frameSeconds;
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
          samples.push(readSamples(audioChunk));
        });
        if (readingNext) {
          var scheduleNext = startTime - ac.currentTime;
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
