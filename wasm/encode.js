define(function() {

  'use strict';
  
  const cache = new Array(16);
  var cache_bytes = new Uint8Array(cache.length);
  for (var i = 0; i < cache.length; i++) {
    cache_bytes[i] = i;
    cache[i] = cache_bytes.subarray(i, i+1);
  }
  
  function leb128_signed(value) {
    if (value >= 0 && value < cache.length) return cache[value];
    var bytes = [];
    for (;;) {
      var byte = value & 0x7f;
      value >>= 7;
      if ((value === 0 && !(byte & 0x40)) || (value === -1 && (byte & 0x40))) {
        bytes.push(byte);
        break;
      }
      bytes.push(byte | 0x80);
    }
    return new Uint8Array(bytes);
  }
  
  function leb128_unsigned(value) {
    if (value >= 0 && value < cache.length) return cache[value];
    var bytes = [];
    for (;;) {
      var byte = value & 0x7f;
      if ((value >>>= 7) === 0) {
        bytes.push(byte);
        break;
      }
      bytes.push(byte | 0x80);
    }
    return new Uint8Array(bytes);
  }
  
  function utf8len(str) {
    var acc = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) acc++;
      else if (c < 0x800) acc += 2;
      else if (c < 0x10000) acc += 3;
      else acc += 4;
    }
    return acc;
  }
  
  function blobPartLengthAccumulator(acc, val) {
    if (typeof val === 'string') return acc + utf8len(val);
    if (val instanceof Blob) return acc + val.size;
    return acc + val.byteLength;
  }
  
  function blobPartsByteLength(blobParts) {
    return blobParts.reduce(blobPartLengthAccumulator, 0);
  }
  
  const SECTION_TYPE = 1,
        SECTION_IMPORT = 2,
        SECTION_FUNCTION = 3,
        SECTION_TABLE = 4,
        SECTION_MEMORY = 5,
        SECTION_GLOBAL = 6,
        SECTION_EXPORT = 7,
        SECTION_START = 8,
        SECTION_ELEMENT = 9,
        SECTION_CODE = 10,
        SECTION_DATA = 11;
  
  const VALUE_TYPES = {
    i32: leb128_signed(-1),
    i64: leb128_signed(-2),
    f32: leb128_signed(-3),
    f64: leb128_signed(-4),
    anyfunc: leb128_signed(-0x10),
    func: leb128_signed(-0x20),
  };
  
  const EXTERNAL_KINDS = {
    func: leb128_unsigned(0),
    table: leb128_unsigned(1),
    memory: leb128_unsigned(2),
    global: leb128_unsigned(3),
  };
  
  const ELEMENT_TYPES = {
    anyfunc: VALUE_TYPES.anyfunc,
  };
  
  const EMPTY_BLOCK_VALUE_TYPE = leb128_signed(-0x40);
  
  const OPCODES = Object.freeze({
    unreachable: 0x00,
    nop: 0x01,
    block: 0x02,
    loop: 0x03,
    'if': 0x04,
    'else': 0x05,
    end: 0x0b,
    br: 0x0c,
    br_if: 0x0d,
    br_table: 0x0e,
    'return': 0x0f,
    call: 0x10,
    call_indirect: 0x11,
    drop: 0x1a,
    select: 0x1b,
    get_local: 0x20,
    set_local: 0x21,
    tee_local: 0x22,
    get_global: 0x23,
    set_global: 0x24,
    'i32.load': 0x28,
    'i64.load': 0x29,
    'f32.load': 0x2a,
    'f64.load': 0x2b,
    'i32.load8_s': 0x2c,
    'i32.load8_u': 0x2d,
    'i32.load16_s': 0x2e,
    'i32.load16_u': 0x2f,
    'i64.load8_s': 0x30,
    'i64.load8_u': 0x31,
    'i64.load16_s': 0x32,
    'i64.load16_u': 0x33,
    'i64.load32_s': 0x34,
    'i64.load32_u': 0x35,
    'i32.store': 0x36,
    'i64.store': 0x37,
    'f32.store': 0x38,
    'f64.store': 0x39,
    'i32.store8': 0x3a,
    'i32.store16': 0x3b,
    'i64.store8': 0x3c,
    'i64.store16': 0x3d,
    'i64.store32': 0x3e,
    current_memory: 0x3f,
    grow_memory: 0x40,
    'i32.const': 0x41,
    'i64.const': 0x42,
    'f32.const': 0x43,
    'f64.const': 0x44,
    'i32.eqz': 0x45,
    'i32.eq': 0x46, 	 
    'i32.ne': 0x47,
    'i32.lt_s': 0x48,
    'i32.lt_u': 0x49,
    'i32.gt_s': 0x4a,
    'i32.gt_u': 0x4b,
    'i32.le_s': 0x4c,
    'i32.le_u': 0x4d,
    'i32.ge_s': 0x4e,
    'i32.ge_u': 0x4f,
    'i64.eqz': 0x50,
    'i64.eq': 0x51,
    'i64.ne': 0x52,
    'i64.lt_s': 0x53,
    'i64.lt_u': 0x54,
    'i64.gt_s': 0x55,
    'i64.gt_u': 0x56,
    'i64.le_s': 0x57,
    'i64.le_u': 0x58,
    'i64.ge_s': 0x59,
    'i64.ge_u': 0x5a,
    'f32.eq': 0x5b,
    'f32.ne': 0x5c,
    'f32.lt': 0x5d,
    'f32.gt': 0x5e,
    'f32.le': 0x5f,
    'f32.ge': 0x60,
    'f64.eq': 0x61,
    'f64.ne': 0x62,
    'f64.lt': 0x63,
    'f64.gt': 0x64,
    'f64.le': 0x65,
    'f64.ge': 0x66,
    'i32.clz': 0x67,
    'i32.ctz': 0x68,
    'i32.popcnt': 0x69,
    'i32.add': 0x6a,
    'i32.sub': 0x6b,
    'i32.mul': 0x6c,
    'i32.div_s': 0x6d,
    'i32.div_u': 0x6e,
    'i32.rem_s': 0x6f,
    'i32.rem_u': 0x70,
    'i32.and': 0x71,
    'i32.or': 0x72,
    'i32.xor': 0x73,
    'i32.shl': 0x74,
    'i32.shr_s': 0x75,
    'i32.shr_u': 0x76,
    'i32.rotl': 0x77,
    'i32.rotr': 0x78,
    'i64.clz': 0x79,
    'i64.ctz': 0x7a,
    'i64.popcnt': 0x7b,
    'i64.add': 0x7c,
    'i64.sub': 0x7d,
    'i64.mul': 0x7e,
    'i64.div_s': 0x7f,
    'i64.div_u': 0x80,
    'i64.rem_s': 0x81,
    'i64.rem_u': 0x82,
    'i64.and': 0x83,
    'i64.or': 0x84,
    'i64.xor': 0x85,
    'i64.shl': 0x86,
    'i64.shr_s': 0x87,
    'i64.shr_u': 0x88,
    'i64.rotl': 0x89,
    'i64.rotr': 0x8a,
    'f32.abs': 0x8b,
    'f32.neg': 0x8c,
    'f32.ceil': 0x8d,
    'f32.floor': 0x8e,
    'f32.trunc': 0x8f,
    'f32.nearest': 0x90,
    'f32.sqrt': 0x91,
    'f32.add': 0x92,
    'f32.sub': 0x93,
    'f32.mul': 0x94,
    'f32.div': 0x95,
    'f32.min': 0x96,
    'f32.max': 0x97,
    'f32.copysign': 0x98,
    'f64.abs': 0x99,
    'f64.neg': 0x9a,
    'f64.ceil': 0x9b,
    'f64.floor': 0x9c,
    'f64.trunc': 0x9d,
    'f64.nearest': 0x9e,
    'f64.sqrt': 0x9f,
    'f64.add': 0xa0,
    'f64.sub': 0xa1,
    'f64.mul': 0xa2,
    'f64.div': 0xa3,
    'f64.min': 0xa4,
    'f64.max': 0xa5,
    'f64.copysign': 0xa6,
    'i32.wrap/i64': 0xa7,
    'i32.trunc_s/f32': 0xa8,
    'i32.trunc_u/f32': 0xa9,
    'i32.trunc_s/f64': 0xaa,
    'i32.trunc_u/f64': 0xab,
    'i64.extend_s/i32': 0xac,
    'i64.extend_u/i32': 0xad,
    'i64.trunc_s/f32': 0xae,
    'i64.trunc_u/f32': 0xaf,
    'i64.trunc_s/f64': 0xb0,
    'i64.trunc_u/f64': 0xb1,
    'f32.convert_s/i32': 0xb2,
    'f32.convert_u/i32': 0xb3,
    'f32.convert_s/i64': 0xb4,
    'f32.convert_u/i64': 0xb5,
    'f32.demote/f64': 0xb6,
    'f64.convert_s/i32': 0xb7,
    'f64.convert_u/i32': 0xb8,
    'f64.convert_s/i64': 0xb9,
    'f64.convert_u/i64': 0xba,
    'f64.promote/f32': 0xbb,
    'i32.reinterpret/f32': 0xbc,
    'i64.reinterpret/f64': 0xbd,
    'f32.reinterpret/i32': 0xbe,
    'f64.reinterpret/i64': 0xbf,
    
    // not ops, but block types:
    i32: 0x7f,
    i64: 0x7e,
    f32: 0x7d,
    f64: 0x7c,
  });
  
  function write_table_type(section, def) {
    section.push(ELEMENT_TYPES[def.elementType]);
    if (isFinite(def.maximumSize)) {
      section.push(
        leb128_unsigned(1),
        leb128_unsigned(def.initialSize),
        leb128_unsigned(def.maximumSize));
    }
    else {
      section.push(
        leb128_unsigned(0),
        leb128_unsigned(def.initialSize));
    }
  }
  
  function write_memory_type(section, def) {
    if (isFinite(def.maximumSize)) {
      section.push(
        leb128_unsigned(1),
        leb128_unsigned(def.initialSize),
        leb128_unsigned(def.maximumSize));
    }
    else {
      section.push(
        leb128_unsigned(0),
        leb128_unsigned(def.initialSize));
    }
  }
  
  function write_global_type(section, def) {
    section.push(VALUE_TYPES[def.dataType]);
    section.push(leb128_unsigned(def.mutable ? 1 : 0));    
  }
  
  function write_instructions(section, code) {
    var buffer, pos, i = 0;
    function alloc() {
      // allocate buffer to next power-of-two from the number of instructions, plus 1 (for the final end)
      buffer = new Uint8Array(1 << Math.ceil(Math.log2((code.length - i) + 1)));
      pos = 0;
    }
    function flush(final) {
      section.push(buffer.subarray(0, pos));
      if (!final) alloc();
    }
    function write_unsigned(v) {
      for (;;) {
        if (pos >= buffer.length) {
          flush();
        }
        var byte = v & 0x7f;
        if ((v >>>= 7) === 0) {
          buffer[pos++] = byte;
          break;
        }
        buffer[pos++] = byte | 0x80;
      }
    }
    function write_signed(v) {
      for (;;) {
        if (pos >= buffer.length) {
          flush();
        }
        var byte = v & 0x7f;
        v >>= 7;
        if ((v === 0 && !(byte & 0x40)) || (v === -1 && (byte & 0x40))) {
          buffer[pos++] = byte;
          break;
        }
        buffer[pos++] = byte | 0x80;
      }
    }
    function memory_immediate(naturalAlignment) {
      var match, alignLog2 = Math.log2(naturalAlignment), offset = 0, setOffset = false, setAlign = false;
      
      do {
        if (!setOffset && (match = (''+code[i]).match(/^offset=(\d+)$/))) {
          i++;
          offset = +match[1];
          setOffset = true;
        }
        else if (!setAlign && (match = (''+code[i]).match(/^align=(\d+)$/))) {
          i++;
          var alignment = +match[1];
          if (alignment > naturalAlignment) {
            throw new Error('alignment size must be no larger than natural alignment');
          }
          alignLog2 = Math.log2(alignment);
          if (alignLog2 !== Math.floor(alignLog2)) {
            throw new Error('align must be a power of 2');
          }
          setAlign = true;
        }
      } while (match && (!setOffset || !setAlign));
      
      var flags = alignLog2;
      
      write_unsigned(flags);
      write_unsigned(offset);
    }
    alloc();
    while (i < code.length) {
      var op = code[i++];
      if (pos >= buffer.length) {
        flush();
      }
      if (typeof op === 'number') {
        write_unsigned(op);
        continue;
      }
      op = OPCODES[op];
      if (typeof op !== 'number') {
        throw new Error('invalid instruction: ' + code[i-1]);
      }
      buffer[pos++] = op;
      switch (op) {
        case 0x02: // block
        case 0x03: // loop
        case 0x04: // if
          if (['i32','i64','f32','f64'].indexOf(code[i]) === -1) {
            write_unsigned(0x40);
          }
          break;
        case 0x0E: // br_table
          var count = 0;
          var j = i;
          while (!isNaN(code[j++])) {
            count++;
          }
          if (count === 0) throw new Error('br_table must have at least one label');
          write_unsigned(count - 1);
          break;
        case 0x11: // call_indirect
          if (isNaN(code[i])) {
            throw new Error('call_indirect must be followed by a typedef index');
          }
          write_unsigned(code[i++]);
          write_unsigned(0); // reserved
          break;
        case 0x2C: // i32.load8_s
        case 0x2D: // i32.load8_u
        case 0x30: // i64.load8_s
        case 0x31: // i64.load8_s
        case 0x3A: // i32.store8
        case 0x3C: // i64.store8
          memory_immediate(1);
          break;
        case 0x2E: // i32.load16_s
        case 0x2F: // i32.load16_u
        case 0x32: // i64.load16_s
        case 0x33: // i64.load16_u
        case 0x3B: // i32.store16
        case 0x3D: // i64.store16
          memory_immediate(2);
          break;
        case 0x28: // i32.load
        case 0x2A: // f32.load
        case 0x34: // i64.load32_s
        case 0x35: // i64.load32_u
        case 0x36: // i32.store
        case 0x38: // f32.store
        case 0x3E: // i64.store32
          memory_immediate(4);
          break;
        case 0x29: // i64.load
        case 0x2B: // f64.load
        case 0x37: // i64.store
        case 0x39: // f64.store
          memory_immediate(8);
          break;
        case 0x3F: // current_memory
        case 0x40: // grow_memory
          write_unsigned(0); // reserved
          break;
        case 0x41: // i32.const
        case 0x42: // i64.const
          var num = code[i++];
          if (isNaN(num)) throw new Error('const without value');
          // TODO: handle actual 64-bit constants somehow
          write_signed(num);
          break;
        case 0x43: // f32.const
          var num = code[i++];
          if (isNaN(num)) throw new Error('const without value');
          if (pos+4 > buffer.length) {
            flush();
            var dv = new DataView(new ArrayBuffer(4));
            dv.setFloat32(0, num, true);
            section.push(dv);
          }
          else {
            new DataView(buffer.buffer).setFloat32(pos, num, true);
            pos += 4;
          }
          break;
        case 0x44: // f64.const
          var num = code[i++];
          if (isNaN(num)) throw new Error('const without value');
          if (pos+8 > buffer.length) {
            flush();
            var dv = new DataView(new ArrayBuffer(4));
            dv.setFloat64(0, num, true);
            section.push(dv);
          }
          else {
            new DataView(buffer.buffer).setFloat64(pos, num, true);
            pos += 8;
          }
          break;
      }
    }
    if (pos >= buffer.length) {
      flush(true);
      section.push(new Uint8Array([OPCODES.end]));
      return;
    }
    buffer[pos++] = OPCODES.end;
    flush(true);
  }
  
  function wasm_encode(module) {
    // for compatibility with the binary-string form (module "...")
    // which wasm_parse() returns as {bytes:<Uint8Array>}
    if (module.bytes instanceof Uint8Array) return new Blob([module.bytes]);
    
    var versionNumber = 1;
    var chunks = ['\0asm', new ArrayBuffer(4)];
    new DataView(chunks[1]).setUint32(0, versionNumber, true);
    
    function addSection(id_or_name, sectionChunks) {
      if (typeof id_or_name === 'string') {
        sectionChunks.unshift(leb128_unsigned(utf8len(id_or_name)), id_or_name);
        chunks.push(leb128_unsigned(0));
      }
      else {
        chunks.push(leb128_unsigned(id_or_name));
      }
      chunks.push(leb128_unsigned(blobPartsByteLength(sectionChunks)));
      chunks.push.apply(chunks, sectionChunks);
    }
    
    var section, def;
    
    if (module.typedefs && module.typedefs.length > 0) {
      section = [leb128_unsigned(module.typedefs.length)];
      for (var i = 0; i < module.typedefs.length; i++) {
        def = module.typedefs[i];
        if (def.type !== 'func') {
          throw new Error('expecting func, got ' + def.type);
        }
        section.push(VALUE_TYPES.func);
        section.push(leb128_unsigned(def.params.length));
        for (var j = 0; j < def.params.length; j++) {
          section.push(VALUE_TYPES[def.params[j]]);
        }
        section.push(leb128_unsigned(def.results.length));
        for (var j = 0; j < def.results.length; j++) {
          section.push(VALUE_TYPES[def.results[j]]);
        }
      }
      addSection(SECTION_TYPE, section);
    }
    
    if (module.imports && module.imports.length > 0) {
      section = [leb128_unsigned(module.imports.length)];
      for (var i = 0; i < module.imports.length; i++) {
        def = module.imports[i];
        section.push(
          leb128_unsigned(def.moduleName.length), def.moduleName,
          leb128_unsigned(def.fieldName.length), def.fieldName,
          EXTERNAL_KINDS[def.kind]);
        switch (def.kind) {
          case 'func':
            section.push(leb128_unsigned(def.typedef_id));
            break;
          case 'table':
            write_table_type(section, def);
            break;
          case 'memory':
            write_memory_type(section, def);
            break;
          case 'global':
            write_global_type(section, def);
            break;
          default:
            throw new Error('unknown import kind: ' + def.kind);
        }
      }
      addSection(SECTION_IMPORT, section);
    }
    
    function nonImported(v) { return !v.isImported; }
    
    var funcs = (module.funcs || []).filter(nonImported);
    var tables = (module.tables || []).filter(nonImported);
    var memorySections = (module.memorySections || []).filter(nonImported);
    var globals = (module.globals || []).filter(nonImported);
    
    if (funcs.length > 0) {
      section = [leb128_unsigned(funcs.length)];
      for (var i = 0; i < funcs.length; i++) {
        var def = funcs[i];
        if (!isNaN(def.body_id) && def.body_id !== i) {
          throw new Error('non-imported function body ids must increment from 0');
        }
        section.push(leb128_unsigned(def.typedef_id));
      }
      addSection(SECTION_FUNCTION, section);
    }
    
    if (tables.length > 0) {
      section = [leb128_unsigned(tables.length)];
      for (var i = 0; i < tables.length; i++) {
        write_table_type(section, tables[i]);
      }
      addSection(SECTION_TABLE, section);
    }
    
    if (memorySections.length > 0) {
      section = [leb128_unsigned(memorySections.length)];
      for (var i = 0; i < memorySections.length; i++) {
        write_memory_type(section, memorySections[i]);
      }
      addSection(SECTION_MEMORY, section);
    }
    
    if (globals.length > 0) {
      section = [leb128_unsigned(globals.length)];
      for (var i = 0; i < globals.length; i++) {
        def = globals[i];
        write_global_type(section, def);
        write_instructions(section, def.initialValue || [def.dataType + '.const', 0]);
      }
      addSection(SECTION_GLOBAL, section);
    }
    
    if (module.exports && module.exports.length > 0) {
      section = [leb128_unsigned(module.exports.length)];
      for (var i = 0; i < module.exports.length; i++) {
        def = module.exports[i];
        section.push(
          leb128_unsigned(utf8len(def.exportAs)), def.exportAs,
          EXTERNAL_KINDS[def.kind], leb128_unsigned(def.id));
      }
      addSection(SECTION_EXPORT, section);
    }
    
    if (!isNaN(module.start)) {
      addSection(SECTION_START, [leb128_unsigned(module.start)]);
    }
    
    if (module.tableElements && module.tableElements.length > 0) {
      section = [leb128_unsigned(module.tableElements.length)];
      for (var i = 0; i < module.tableElements.length; i++) {
        def = module.tableElements[i];
        section.push(leb128_unsigned(def.table_id));
        write_instructions(section, def.offset);
        section.push(leb128_unsigned(def.func_ids.length));
        for (var j = 0; j < def.func_ids.length; j++) {
          section.push(leb128_unsigned(def.func_ids[j]));
        }
      }
      addSection(SECTION_ELEMENT, section);
    }
    
    if (module.functionBodies && module.functionBodies.length > 0) {
      section = [leb128_unsigned(module.functionBodies.length)];
      for (var i = 0; i < module.functionBodies.length; i++) {
        def = module.functionBodies[i];
        var locals = def.locals || [];
        var body = [];
        // add locals, in batches of the same type
        for (var j = 0; j < locals.length; j++) {
          var count = 1;
          while (locals[j+1] === locals[j]) {
            j++;
            count++;
          }
          body.push(
            leb128_unsigned(count),
            leb128_unsigned(VALUE_TYPES[locals[j]]));
        }
        // prefix with the number of local-batches
        body.unshift(leb128_unsigned(body.length/2));
        write_instructions(body, def);
        section.push(leb128_unsigned(blobPartsByteLength(body)));
        section.push.apply(section, body);
      }
      addSection(SECTION_CODE, section);
    }
    
    if (module.dataSections && module.dataSections.length > 0) {
      section = [leb128_unsigned(module.dataSections.length)];
      for (var i = 0; i < module.dataSections.length; i++) {
        def = module.dataSections[i];
        section.push(leb128_unsigned(def.memory_id));
        write_instructions(body, def.offset);
        section.push(leb128_unsigned(def.bytes.length), def.bytes);
      }
      addSection(SECTION_DATA, section);
    }
    
    return new Blob(chunks);
  }
  
  return wasm_encode;

});
