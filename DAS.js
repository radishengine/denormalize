define(['blobMethods'], function() {

  'use strict';
  
  const LITTLE_ENDIAN = (new Uint16Array(new Uint8Array([1, 0]).buffer)[0] === 1);
    
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
    get totalByteLength() {
      return this.dv.getUint32(0, true);
    },
    get byteLength() {
      return this.dv.getUint16(4, true);
    },
    get frameCount() {
      return this.dv.getUint16(6, true);
    },
    // 3 bytes always 0xFFFFFF
    get speed() {
      return this.dv.getUint8(11, true);
    },
    get approximateDuration() {
      switch (this.speed) {
        case 0x02: return 70;
        case 0x03: return 60; // 57;
        case 0x04: return 100;
        case 0x06: return 130; // 128;
        case 0x07: return 170;
        case 0x08: return 190; // 186;
        case 0x0A: return 210; // 214;
        case 0x0E: return 270;
        case 0x10: return 60; // 57;
        default:
          console.warn('unknown animation speed: ' + this.speed);
          return 100;
      }
    },
    get deltaOffsets() {
      var list = new Array(this.frameCount);
      for (var i = 0; i < list.length; i++) {
        var offset = this.dv.getUint32(12 + i*4, true);
        list[i] = offset && offset-10;
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
    get height() {
      return this.dv.getUint16(2, true);
    },
    get width() {
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
    get retrievedData() {
      var blob = this.blob, offset = this.offset;
      // 10 bytes is just enough to get the total size
      var promise = blob.readBuffered(this.offset, Math.min(blob.size, offset + 10))
      .then(function(headerBytes) {
        var tempHeader = new DASImageHeader(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
        if (tempHeader.isAnimated) {
          return blob.readBuffered(offset, offset + tempHeader.animation.totalByteLength);
        }
        else {
          return blob.readBuffered(offset, offset + tempHeader.byteLength + tempHeader.width * tempHeader.height);
        }
      });
      Object.defineProperty(this, 'retrievedData', {value:promise, enumerable:true});
      return promise;
    },
    get retrievedHeader() {
      var promise = this.retrievedData.then(function(data) {
        return new DASImageHeader(data.buffer, data.byteOffset, data.byteLength);
      });
      Object.defineProperty(this, 'retrievedHeader', {value:promise, enumerable:true});
      return promise;
    },
    getFirstFrame: function() {
      return this.retrievedData.then(function(data) {
        var header = new DASImageHeader(
          data.buffer,
          data.byteOffset,
          data.byteLength);
        return Object.assign(
          // cloned so it can be rotated in-place
          new Uint8Array(data.subarray(
            header.byteLength,
            header.byteLength + header.width * header.height)),
          {width:header.width, height:header.height});
      });
    },
    get palette() {
      return this.das.opaquePalette; // this.kind === 'sprite' ? this.das.transparentPalette : this.das.opaquePalette;
    },
    getAllFrames: function() {
      return Promise.all([this.retrievedData, this.getFirstFrame()])
      .then(function(values) {
        var data = values[0], frames = [values[1]];
        var header = new DASImageHeader(data.buffer, data.byteOffset, data.byteLength);
        if (!header.isAnimated) return frames;
        var ms = header.animation.approximateDuration;
        var offsets = header.animation.deltaOffsets;
        var i;
        for (i = offsets.length-1; i >= 0; i--) {
          if (offsets[i] !== 0) break;
        }
        if (i < 0) return frames;
        offsets = offsets.slice(0, i); // removing final frame (restores the first) and any trailing zeros
        offsets.splice(0, 0, null); // null: placeholder "offset" for non-delta frame
        var durations = [];
        for (i = 0; i < offsets.length; i++) {
          var duration = ms;
          if (offsets[i+1] === 0) {
            var n = 0;
            do { duration += ms; } while (offsets[i+(++n)+1] === 0);
            offsets.splice(i+1, n);
          }
          durations.push(duration);
        }
        frames.length = durations.length;
        frames[0].duration = durations[0];
        var dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
        for (var frame_i = 1; frame_i < frames.length; frame_i++) {
          var in_i = offsets[frame_i], out_i = 0;
          var frame = frames[frame_i] = new Uint8Array(frames[frame_i-1]);
          frame.duration = durations[frame_i];
          frame.replace = true;
          frame.width = frames[0].width;
          frame.height = frames[0].height;
          for (;;) {
            var code = data[in_i++];
            if (code === 0) {
              var repCount = data[in_i++];
              var repPixel = data[in_i++];
              while (repCount--) frame[out_i++] = repPixel;
              continue;
            }
            if (code === 0x80) {
              var param = dv.getUint16(in_i, true);
              in_i += 2;
              if (param === 0) break;
              if ((param & 0xC000) === 0xC000) {
                var repCount = param & 0x3FFF, repPixel = data[in_i++];
                while (repCount--) frame[out_i++] = repPixel;
                continue;
              }
              out_i += param;
              continue;
            }
            if (code > 0x80) {
              if (code === 0xFF && data[in_i] > 0x80) {
                out_i += data[in_i++] - 1;
                continue;
              }
              out_i += code - 0x80;
              continue;
            }
            frame.set(data.subarray(in_i, in_i + code), out_i);
            in_i += code;
            out_i += code;
          }
        }
        return frames;
      });
    },
    getImage: function() {
      var palette = this.palette;
      return this.getAllFrames().then(function(frames) {
        var rotated = new Uint8Array(frames[0].length);
        for (var i_frame = 0; i_frame < frames.length; i_frame++) {
          var frame = frames[i_frame];
          var w = frame.width, h = frame.height;
          for (var i = 0; i < frame.length; i++) {
            rotated[i] = frame[(i % w)*h + ((i / w)|0)];
          }
          frame.set(rotated);
        }
        return GIF.encode(palette, frames);
      });
    },
  };
  
  function DAS(blob, fileHeader, offsetRecords, palette, nameSection) {
    this.blob = blob;
    this.fileHeader = fileHeader;
    this.opaquePalette = palette;
    this.transparentPalette = new Uint32Array(palette);
    this.transparentPalette[0] = 0;
    
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
      var gotPalette = blob.readBuffered(
        fileHeader.paletteOffset,
        fileHeader.paletteOffset + 256 * 3).then(readPalette);
      var gotNamesSection = blob.slice(
        fileHeader.namesOffset,
        fileHeader.namesOffset + fileHeader.namesByteLength)
      .readArrayBuffer().then(function(ab) {
        return new DASNamesSection(ab, 0, ab.byteLength);
      });
      return Promise.all([gotImageRecords, gotPalette, gotNamesSection]).then(function(values) {
        var imageRecords = values[0], palette = values[1], namesSection = values[2];
        return new DAS(
          blob,
          fileHeader,
          imageRecords,
          palette,
          namesSection);
      });
    });
  };

  DAS.FileHeader = DASFileHeader;
  DAS.NamesSection = DASNamesSection;
  DAS.Animation = DASAnimation;
  DAS.ImageHeader = DASImageHeader;
  DAS.Image = DASImage;

  return DAS;

});
