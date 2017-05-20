define(function() {
  
  'use strict';
  
  function nextWord(t, checkWord) {
    if (typeof t[t.i] !== 'string') return null;
    if (typeof checkWord === 'string' && checkWord !== t[t.i]) return null;
    if (Array.isArray(checkWord) && checkWord.indexOf(t[t.i]) < 0) return null;
    if (checkWord instanceof RegExp) {
      var match = t[t.i].match(checkWord);
      if (match) {
        t[t.i++];
        if (match[0] === match.input) return match.input;
        return match;
      }
      return null;
    }
    return t[t.i++];
  }
  
  function requireWord(t, checkWord) {
    var v = nextWord(t, checkWord);
    if (!v) {
      var expecting = '<word>';
      if (typeof checkWord === 'string') expecting = checkWord;
      if (Array.isArray(checkWord)) expecting = checkWord.join('/');
      if (checkWord instanceof RegExp) expecting = checkWord.toString();
      throw new Error('('+t.type+' ...): expecting ' + expecting);
    }
    return v;
  }

  function nextName(t) {
    if (typeof t[t.i] === 'string' && t[t.i][0] === '$') return t[t.i++];
  }
  
  function nextNumber(t) {
    if (typeof t[t.i] === 'number') return t[t.i++];
    return NaN;
  }
  
  function requireNumber(t) {
    var v = nextNumber(t);
    if (isNaN(v)) throw new Error('('+t.type+' ...): expecting number');
    return v;
  }

  function nextInt(t) {
    if (Math.floor(t[t.i]) !== t[t.i]) return NaN;
    return t[t.i++];
  }
  
  function requireInt(t) {
    var v = nextInt(t);
    if (isNaN(v)) throw new Error('('+t.type+' ...): expecting int');
    return v;
  }

  // note: be careful to check for (nextRef(...)===null) instead of !nextRef(...)
  function nextRef(t, set) {
    var ref;
    if (typeof t[t.i] === 'number' && t[t.i] === Math.floor(t[t.i])) ref = t[t.i++];
    else if (typeof t[t.i] === 'string' && t[t.i][0] === '$') ref = t[t.i++];
    else return null;
    if (!(ref in set)) {
      throw new Error('(' + t.type + ' ...): undefined ' + set.element_kind + ' ref ' + ref);
    }
    return (typeof ref === 'string') ? set[ref] : +ref;
  }

  function requireRef(t, set) {
    var v = nextRef(t, set);
    if (v === null) throw new Error('('+t.type+' ...): expected '+set.element_kind+' ref, got ' + t[t.i]);
    return v;
  }
  
  function maybeDefineRef(t, set, id) {
    var name = nextName(t);
    if (!name) return;
    if (name in set) throw new Error('duplicate '+set.element_kind+' ref: ' + name);
    set[name] = id;
  }
  
  function nextSection(t, typeCheck) {
    if (!Array.isArray(t[t.i])) return null;
    if (typeof typeCheck === 'string' && t[t.i].type !== typeCheck) return null;
    if (Array.isArray(typeCheck) && typeCheck.indexOf(t[t.i].type) === -1) return null;
    if (typeCheck instanceof RegExp && !typeCheck.test(t[t.i]).type) return null;
    return t[t.i++];
  }

  function requireSection(t, typeCheck) {
    var s = nextSection(t, typeCheck);
    if (!s) {
      var expecting = '';
      if (typeof typeCheck === 'string') expecting = typeCheck;
      if (Array.isArray(typeCheck)) expecting = typeCheck.join('/');
      if (typeCheck instanceof RegExp) expecting = typeCheck.toString();
      throw new Error('('+t.type+' ...): expecting ('+expecting+' ...)');
    }
    return s;
  }

  function isName(v) {
    return (typeof v === 'string' && v[0] === '$');
  }

  function nextString(t) {
    if (t[t.i] instanceof String) return t[t.i++].valueOf();
  }
  
  function requireString(t) {
    var s = nextString(t);
    if (!s) throw new Error('('+t.type+' ...): expecting string');
    return s;
  }
  
  function requireEnd(t) {
    if (t.i !== t.length) throw new Error('('+t.type+' ...): unexpected content');
  }
  
  function readOp(scope, output, code) {
    var op = requireWord(code);
    var demangled_op, numType, numSize, numSize2, signedness, fromType, fromSize;
    var modifiers = op.match(/^([if])(32|64)\.(.+?)(8|16|32|64)?(?:_([su]))?(?:\/([if])(8|16|32|64))?$/);
    if (modifiers) {
      numType = modifiers[1];
      numSize = modifiers[2];
      demangled_op = modifiers[3];
      numSize2 = modifiers[4] || numSize;
      signedness = modifiers[5] || 'x'; // s for signed, u for unsigned, x for unspecified
      fromType = modifiers[6];
      fromSize = modifiers[7];
    }
    else demangled_op = op;
    switch (demangled_op) {
      case 'if': case 'else': case 'end': case 'block': case 'loop':
        throw new Error('readOp() is the wrong place to handle structural delimiters like "'+op+'"');
      case 'unreachable':
      case 'nop':
      case 'return':
      case 'drop':
      case 'select':
      case 'current_memory': case 'grow_memory':
      case 'eq': case 'ne': case 'eqz':
      case 'lt': case 'gt': case 'le': case 'ge':
      case 'clz':  case 'ctz': case 'popcnt':
      case 'add': case 'sub': case 'mul': case 'div': case 'rem':
      case 'and': case 'or': case 'xor':
      case 'shl': case 'shr':
      case 'rotl': case 'rotr':
      case 'abs':
      case 'neg':
      case 'ceil': case 'floor': case 'trunc': case 'nearest':
      case 'sqrt':
      case 'min': case 'max':
      case 'copysign':
      case 'wrap':
      case 'trunc':
      case 'extend':
      case 'convert':
      case 'demote':
      case 'promote':
      case 'reinterpret':
        output.push(op);
        return;
      case 'br': case 'br_if':
        var label = requireRef(code, scope.blockLevels);
        if (typeof code[code.i-1] === 'string') {
          label = scope.blockLevels.length - label;
        }
        output.push(op, label);
        return;
      case 'call':
      case 'call_indirect':
        output.push(op, requireRef(code, scope.module.funcs));
        return;
      case 'get_local': case 'set_local': case 'tee_local':
        output.push(op, requireRef(code, scope.locals));
        return;
      case 'get_global': case 'set_global':
        output.push(op, requireRef(code, scope.module.globals));
        return;
      case 'br_table':
        output.push(op);
        var label = requireRef(code, scope.blockLevels);
        do {
          if (typeof code[code.i-1] === 'string') {
            label = scope.blockLevels.length - label;
          }
          output.push(label);
        } while ((label = nextRef(code, scope.blockLevels)) !== null);
        return;
      case 'load': case 'store':
        output.push(op);
        output.push(nextWord(code, /^offset=\d+$/) || 'offset=0');
        output.push(nextWord(code, /^align=\d+$/) || ('align='+numSize2/8));
        return;
      case 'const':
        output.push(op, requireNumber(code));
        return;
      default:
        throw new Error('unknown op: ' + op);
    }
  }
  
  function enterBlock(scope, name) {
    var def = {id:scope.blockLevels.length+1, names:[], type:'blocklevel'};
    scope.blockLevels.push(def);
    if (name) {
      if (name in scope.blockLevels) def.hiding = true;
      scope.blockLevels[name] = def.id;
      def.names.push(name);
    }
  }
  
  function leaveBlock(scope) {
    var def = scope.blockLevels.pop();
    if (!def) throw new Error('end without block/loop/if');
    for (var i = 0; i < def.names.length; i++) {
      delete scope.blockLevels[def.names[i]];
    }
    if (def.hiding) {
      for (var i = 0; i < scope.blockLevels.length; i++)
      for (var j = 0; j < scope.blockLevels[i].names.length; j++) {
        scope.blockLevels[scope.blockLevels[i].names[j]] = i+1;
      }
    }
  }
  
  function readExpression(scope, output, expr) {
    var dataType;
    switch (expr.type) {
      case 'block':
      case 'loop':
        output.push(expr.type);
        enterBlock(scope, nextName(expr));
        while (dataType = nextWord(expr, /^[if](32|64)$/)) {
          output.push(dataType);
        }
        readInstructions(scope, output, expr);
        output.push('end');
        leaveBlock(scope);
        break;
      case 'if':
        var blockName = nextName(expr);
        var blockTypes = [];
        while (dataType = nextWord(expr, /^[if](32|64)$/)) {
          blockTypes.push(dataType);
        }
        var _then = nextSection(expr, 'then');
        if (!_then) {
          // condition must be specified first
          readExpression(scope, output, requireSection(expr));
          _then = nextSection(expr, 'then');
        }
        output.push('if');
        output.push.apply(output, blockTypes);
        enterBlock(scope, blockName);
        if (_then) {
          readInstructions(scope, output, _then);
          var _else = nextSection(expr, 'else');
          if (_else) {
            output.push('else');
            readInstructions(scope, output, _else);
          }
        }
        else {
          // clause(s) are <expr>s instead of (then ...) (else ...)
          // kinda like (select (<then_expr>) (<else_expr>) (<condition_expr>))
          readExpression(scope, output, requireSection(expr));
          if (expr.i < expr.length) {
            output.push('else');
            readExpression(scope, output, requireSection(expr));
          }
        }
        output.push('end');
        leaveBlock(scope);
        requireEnd(expr);
        return expr;
      default:
        expr.unshift(expr.type);
        var splicer = [output.length, 0];
        readOp(scope, output, expr);
        while (expr.i < expr.length) {
          readExpression(scope, splicer, requireSection(expr));
        }
        output.splice.apply(output, splicer);
        return expr;
    }
  }
  
  function readInstructions(scope, output, code) {
    var blockName, dataType;
    var initialBlockLevel = scope.blockLevels.length;
    reading: for (;;) {
      switch (code[code.i]) {
        case 'block':
        case 'loop':
        case 'if':
          output.push(nextWord(code));
          enterBlock(scope, nextName(code));
          while (dataType = nextWord(code, /^[if](32|64)$/)) {
            output.push(dataType);
          }
          var depth = 0;
          var j = code.i;
          endFinding: while (j < code.length) switch (code[j++]) {
            case 'block': case 'loop': case 'if':
              depth++;
              continue endFinding;
            case 'end':
              if (--depth < 0) break endFinding;
              continue endFinding;
          }
          if (typeof code[j] === 'string' && code[j][0] === '$') {
            var block = scope.blockLevels[scope.blockLevels.length-1];
            if (code[j] in scope.blockLevels) {
              block.hiding = true;
            }
            block.names.push(code[j]);
            scope.blockLevels[code[j]] = block.id;
          }
          continue reading;
        case 'else':
          var block = scope.blockLevels[scope.blockLevels.length-1];
          // TODO: check block type?
          if (!block) throw new Error('else without matching if');
          output.push(nextWord(code));
          if ((blockName = nextName(code)) && block.names.indexOf(blockName) === -1) {
            block.names.push(blockName);
            if (blockName in scope.blockLevels) {
              block.hiding = true;
            }
            scope.blockLevels[blockName] = block.id;
          }
          continue reading;
        case 'end':
          output.push(nextWord(code));
          nextName(code); // ignore, should have been handled earlier
          leaveBlock(scope);
          if (scope.blockLevels.length < initialBlockLevel) {
            throw new Error('end for unopened block');
          }
          continue reading;
        default:
          if (code.i === code.length) {
            if (scope.blockLevels.length !== initialBlockLevel) {
              throw new Error('unterminated block');
            }
            return output;
          }
          var instr;
          if (typeof code[code.i] === 'string') {
            readOp(scope, output, code);
          }
          else {
            readExpression(scope, output, requireSection(code));
          }
          continue reading;
      }
    }
  }
  
  function readFuncTypedef(output, section) {
    output.type = 'func';
    output.params = [];
    output.results = [];
    var subsection;
    while (subsection = nextSection(section, 'param')) {
      var name = nextName(subsection);
      if (name) {
        output.params[name] = output.params.length;
        output.params.push(requireWord(subsection, /^[if](32|64)$/));
        requireEnd(subsection);
      }
      else while (subsection.i < subsection.length) {
        output.params.push(requireWord(subsection, /^[if](32|64)$/));
      }
    }
    while (subsection = nextSection(section, 'result')) {
      output.results.push(requireWord(subsection, /^[if](32|64)$/));
    }
    if (output.results.length > 1) {
      throw new Error('more than 1 result is not currently supported');
    }
    output.signature = [
      output.params.join(',') || 'void',
      output.results.join(',') || 'void',
    ].join(' -> ');
    return output;
  }

  function wasm_parse(wat) {
    var activeRx = /\S|$/g;
    var nestingCommentRx = /\(;|;\)/g;
    var tokenRx = /"(?:\\.|[^\\"]+)*"|(-?\s*(?:0x[a-f0-9]+|\d+(?:\.\d+)?))(?![a-z\._\$])|[a-z\$][^\s()";]*|[()]|$/gi;
    var match, nextAt = 0;
    function rewind() {
      nextAt = tokenRx.lastIndex = match.index;
    }
    function skipPrelude() {
      for (;;) {
        activeRx.lastIndex = nextAt;
        nextAt = activeRx.exec(wat).index; // activeRx can't fail
        var startComment = wat.slice(nextAt, nextAt+2);
        if (startComment === ';;') {
          nextAt = wat.indexOf('\n', nextAt+2);
          if (nextAt < 0) nextAt = wat.length;
          continue;
        }
        if (startComment !== '(;') break;
        var depth = 1;
        nestingCommentRx.lastIndex = nextAt+2;
        var bracket;
        while (bracket = nestingCommentRx.exec(wat)) {
          if (bracket[0] === ';)') {
            if (--depth < 1) break;
          }
          else depth++;
        }
        if (depth !== 0) throw new Error('unbalanced nesting comment');
        // if depth is zero, bracket must be a match object
        nextAt = bracket.index + 2;
      }
      tokenRx.lastIndex = nextAt;
    }
    function nextToken() {
      skipPrelude();
      match = tokenRx.exec(wat);
      if (match.index !== nextAt) {
        throw new Error('unrecognized content in s-expression');
      }
      nextAt = match.index + match[0].length;
      if (match[0].length === 0) return null;
      if (match[0][0] === '"') {
        return new String(match[0].slice(1, -1)
        .replace(/\\([0-9a-f]{2}|.)/gi,
          function(escape) {
            if (escape[1].length === 2) {
              return String.fromCharCode(parseInt(escape[1], 16));
            }
            if (escape[1] === 'n') return '\n';
            if (escape[1] === 't') return '\t';
            return escape[1];
          }));
      }
      if (match[1]) return +match[1];
      return match[0];
    }
    function nextExpression() {
      var token;
      switch (token = nextToken()) {
        case null: return null;
        case '(':
          var subexpr = [];
          subexpr.type = nextExpression();
          if (typeof subexpr.type !== 'string' || !/^[a-z]/.test(subexpr.type)) {
            throw new Error('invalid section');
          }
          subexpr.i = 0;
          for (;;) {
            token = nextToken();
            if (token === ')') break;
            if (token === null) {
              throw new Error('mismatched parentheses');
            }
            rewind();
            subexpr.push(nextExpression());
          }
          return subexpr;
        case ')': throw new Error('mismatched parentheses');
        default: return token;
      }
    }
    var doc = nextExpression();
    if (doc === null) throw new Error('empty document');
    if (nextToken() !== null) throw new Error('more than one top-level element');
    if (doc.type !== 'module') throw new Error('top-level element must be (module ...)');
    
    var module = {type:'module', name:nextName(doc)};
    if (doc[doc.i] instanceof String) {
      var start_i = doc.i++;
      while (doc.i < doc.length) requireString(doc);
      var dataString = doc.slice(start_i).join('');
      module.bytes = new Uint8Array(dataString.length);
      for (var j = 0; j < dataString.length; j++) {
        module.bytes[j] = dataString.charCodeAt(j);
      }
      return module;
    }
    Object.assign(module, {
      typedefs: Object.assign([], {element_kind:'type'}),
      exports: [],
      imports: [],
      funcs: Object.assign([], {element_kind:'func'}),
      tables: Object.assign([], {element_kind:'table'}),
      memorySections: Object.assign([], {element_kind:'memory'}),
      functionBodies: [],
      globals: Object.assign([], {element_kind:'global'}),
      dataSections: [],
      tableElements: [],
    });
    
    var section, name, subsection, def;
    function maybeInlineExport(def, section) {
      var subsection = nextSection(section, 'export');
      if (subsection) {
        // TODO: multiple exports for the same thing?
        def.exportAs = requireString(subsection);
        requireEnd(subsection);
        module.exports.push(def);
      }
    }
    while (doc.i < doc.length) switch ((section = requireSection(doc)).type) {
      default:
        throw new Error('unknown module section: ' + section.type);
      case 'type':
        module.typedefs.push(def = {id: module.typedefs.length});
        maybeDefineRef(section, module.typedefs, def.id);
        // assume that (type (type ...)) is not valid, even though it currently
        // appears to be, according to the grammar
        readFuncTypedef(def, requireSection(section, 'func'));
        requireEnd(section);
        if (!(def.signature in module.typedefs)) {
          module.typedefs[def.signature] = def.id;
        }
        continue;
      case 'import':
        module.imports.push(def = {isImported:true});
        def.moduleName = requireString(section);
        def.fieldName = requireString(section);
        subsection = requireSection(section, ['func','global','table','memory']);
        requireEnd(section);
        section = subsection;
        switch (def.kind = section.type) {
          case 'func':
            if (module.funcs.length > 0 && !module.funcs[module.funcs.length-1].isImported) {
              throw new Error('imported functions must all be declared before the first locally-defined function');
            }
            def.id = module.funcs.length;
            module.funcs.push(def);
            maybeDefineRef(section, module.funcs, def.id);
            if (subsection = nextSection(section, 'type')) {
              def.typedef_id = requireRef(section, module.typedefs);
              requireEnd(subsection);
            }
            else {
              var typedef = readFuncTypedef(def, section);
              if (typedef.signature in module.typedefs) {
                def.typedef_id = module.typedefs[typedef.signature];
              }
              else {
                def.typedef_id = module.typedefs.length;
                module.typedefs.push(def);
                module.typedefs[def.signature] = def.typedef_id;
                typedef = def;
              }
            }
            break;
          case 'global':
            if (module.globals.length > 0 && !module.globals[module.globals.length-1].isImported) {
              throw new Error('imported globals must be declared before the first non-imported global');
            }
            def.id = module.globals.length;
            module.globals.push(def);
            maybeDefineRef(section, module.globals, def.id);
            if (subsection = nextSection(section, 'mut')) {
              def.mutable = true;
              def.dataType = requireWord(subsection, ['i32','i64','f32','f64']);
              requireEnd(subsection);
            }
            else {
              def.mutable = false;
              def.dataType = requireWord(section, ['i32','i64','f32','f64']);
            }
            break;
          case 'table':
            if (module.tables.length > 0 && !module.tables[module.tables.length-1].isImported) {
              throw new Error('imported tables must be declared before the first non-imported global');
            }
            def.id = module.tables.length;
            module.tables.push(def);
            maybeDefineRef(section, module.tables, def.id);
            def.initialSize = requireInt(section);
            def.maximumSize = nextInt(section);
            if (isNaN(def.maximumSize)) def.maximumSize = Infinity;
            def.elementType = requireWord(section, 'anyfunc');
            break;
          case 'memory':
            if (module.memorySections.length > 0 && !module.memorySections[module.memorySections.length-1].isImported) {
              throw new Error('imported memory sections must be declared for the first non-imported section');
            }
            def.id = module.memorySections.length;
            module.memorySections.push(def);
            maybeDefineRef(section, module.memorySections, def.id);
            def.initialSize = requireInt(section);
            def.maximumSize = nextInt(section);
            if (isNaN(def.maximumSize)) def.maximumSize = Infinity;
            break;
        }
        requireEnd(section);
        continue;
      case 'func':
        module.funcs.push(def = {kind:'func', id:module.funcs.length});
        maybeDefineRef(section, module.funcs, def.id);
        if (subsection = nextSection(section, 'import')) {
          if (module.funcs.length > 1 && !module.funcs[module.funcs.length-2].isImported) {
            throw new Error('all imported funcs must be defined before any non-imported');
          }
          def.isImported = true;
          def.moduleName = requireString(subsection);
          def.fieldName = requireString(subsection);
          requireEnd(subsection);
          module.imports.push(def);
        }
        else {
          maybeInlineExport(def, section);
        }
        readFuncTypedef(def, section);
        if (def.signature in module.typedefs) {
          def.typedef_id = module.typedefs[def.signature];
        }
        else {
          def.typedef_id = module.typedefs.length;
          module.typedefs.push(def);
          module.typedefs[def.signature] = def.typedef_id;
        }
        if (def.isImported) {
          requireEnd(section);
          continue;
        }
        var body = section;
        def.body_id = module.functionBodies.length;
        module.functionBodies.push(body);
        body.params = def.params;
        body.locals = [];
        while (subsection = nextSection(section, 'local')) {
          if (name = nextName(subsection)) {
            body.locals[name] = body.locals.length;
            body.locals.push(requireWord(subsection, ['i32','i64','f32','f64']));
            requireEnd(subsection);
          }
          else while (subsection.i < subsection.length) {
            body.locals.push(requireWord(subsection, ['i32','i64','f32','f64']));
          }
        }
        continue;
      case 'table':
        module.tables.push(def = {kind:'table', id:module.tables.length});
        maybeDefineRef(section, module.tables, def.id);
        if (subsection = nextSection(section, 'import')) {
          if (module.tables.length > 1 && !module.tables[module.tables.length-2].isImported) {
            throw new Error('all imported tables must be defined before any non-imported');
          }
          def.isImported = true;
          def.moduleName = requireString(subsection);
          def.fieldName = requireString(subsection);
          requireEnd(subsection);
          module.imports.push(def);
        }
        else {
          maybeInlineExport(def, section);
        }
        def.initialSize = requireInt(section);
        def.maximumSize = nextInt(section);
        if (isNaN(def.maximumSize)) def.maximumSize = Infinity;
        def.elementType = requireWord(section, 'anyfunc');
        requireEnd(section);
        continue;
      case 'memory':
        module.memorySections.push(def = {kind:'memory', id:module.memorySections.length});
        maybeDefineRef(section, module.memorySections, def.id);
        if (subsection = nextSection(section, 'import')) {
          if (module.memorySections.length > 1 && !module.memorySections[module.memorySections.length-2].isImported) {
            throw new Error('all imported memory sections must be defined before any non-imported');
          }
          def.isImported = true;
          def.moduleName = requireString(subsection);
          def.fieldName = requireString(subsection);
          requireEnd(subsection);
          module.imports.push(def);
        }
        else {
          maybeInlineExport(def, section);
        }
        if (!def.isImported && (subsection = nextSection(section, 'data'))) {
          while (subsection.i < subsection.length) requireString(subsection);
          var dataString = subsection.join('');
          var bytes = new Uint8Array(dataString.length);
          for (var i = 0; i < dataString.length; i++) {
            bytes[i] = dataString.charCodeAt(i);
          }
          def.initialSize = def.maximumSize = bytes.length;
          module.dataSections.push({
            memory_id: def.id,
            bytes: bytes,
            offset: Object.assign([0], {type:'i32.const', i:0}),
          });
        }
        else {
          def.initialSize = requireInt(section);
          def.maximumSize = nextInt(section);
          if (isNaN(def.maximumSize)) def.maximumSize = Infinity;
        }
        requireEnd(section);
        continue;
      case 'global':
        module.globals.push(def = {kind:'global', id:module.globals.length});
        maybeDefineRef(section, module.globals, def.id);
        if (subsection = nextSection(section, 'import')) {
          if (module.globals.length > 1 && !module.globals[module.globals.length-2].isImported) {
            throw new Error('all imported globals must be defined before any non-imported');
          }
          def.isImported = true;
          def.moduleName = requireString(subsection);
          def.fieldName = requireString(subsection);
          requireEnd(subsection);
          module.imports.push(def);
        }
        else {
          maybeInlineExport(def, section);
        }
        if (subsection = nextSection(section, 'mut')) {
          def.mutable = true;
          def.dataType = requireWord(subsection, ['i32','i64','f32','f64']);
          requireEnd(subsection);
        }
        else {
          def.mutable = false;
          def.dataType = requireWord(section, ['i32','i64','f32','f64']);
        }
        if (def.isImported) {
          requireEnd(section);
        }
        else {
          if (section.i === section.length) {
            def.initialValue = Object.assign([def.dataType + '.const', 0], {i:0});
          }
          else {
            def.initialValue = section;
          }
        }
        continue;
      case 'export':
        module.exports.push(def = {
          type: 'export',
          id: module.exports.length,
          export_symbol: requireString(section),
        });
        subsection = requireSection(section, ['func','global','table','memory']);
        requireEnd(section);
        def.export_type = subsection.type;
        def.export_id = requireRef(subsection, ({
          func: module.funcs,
          global: module.globals,
          table: module.tables,
          memory: module.memorySections,
        })[subsection.type]);
        requireEnd(subsection);
        continue;
      case 'start':
        module.start = requireRef(section, module.funcs);
        requireEnd(section);
        continue;
      case 'elem':
        module.tableElements.push(def = {
          table_id: nextRef(section, module.tables) || 0,
        });
        def.offset = requireSection(section);
        def.func_ids = [];
        while (section.i < section.length) {
          def.funcs.push(requireRef(section, module.funcs));
        }
        continue;
      case 'data':
        module.dataSections.push(def = {
          type: 'data',
          id: module.dataSections.length,
          memory_id: nextRef(section, module.memorySections) || 0,
        });
        def.offset = requireSection(section);
        var start_i = section.i;
        while (section.i < section.length) requireString(section);
        var byteString = section.slice(start_i).join('');
        def.bytes = new Uint8Array(byteString.length);
        for (var i = 0; i < byteString.length; i++) {
          def.bytes[i] = byteString.charCodeAt(i);
        }
        continue;
    }
    if (module.tables.length > 1) throw new Error('only 1 table section is allowed currently');
    if (module.memorySections.length > 1) throw new Error('only 1 memory section is allowed currently');
    function processInstructions(body, paramsAndLocals) {
      var scope = {
        blockLevels: Object.assign([], {element_kind:'blocklevel'}),
        module: module,
        locals: paramsAndLocals || [],
      };
      return readInstructions(scope, [], body);
    }
    for (var i = 0; i < module.functionBodies.length; i++) {
      var body = module.functionBodies[i];
      var paramsAndLocals = body.params.concat(body.locals);
      for (var k in body.params) {
        if (k[0] === '$') paramsAndLocals[k] = body.params[k];
      }
      for (var k in body.locals) {
        if (k[0] === '$') paramsAndLocals[k] = body.locals[k] + body.params.length;
      }
      module.functionBodies[i] = processInstructions(body, paramsAndLocals);
      module.functionBodies[i].locals = body.locals.slice();
    }
    for (var i = 0; i < module.globals.length; i++) {
      if (!module.globals[i].isImported) {
        module.globals[i].initialValue = processInstructions(module.globals[i].initialValue);
      }
    }
    for (var i = 0; i < module.dataSections.length; i++) {
      module.dataSections[i].offset = processInstructions(module.dataSections[i].offset);
    }
    for (var i = 0; i < module.tableElements.length; i++) {
      module.tableElements[i].offset = processInstructions(module.tableElements[i].offset);
    }
    return module;
  }

  return wasm_parse;

});
