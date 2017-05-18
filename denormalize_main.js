requirejs.config({
  waitSeconds: 0,
});

define(['GIF', 'MGL', 'GDV', 'DAS', 'blobMethods'],
function(GIF, MGL, GDV, DAS) {

  'use strict';
  
  var ac = new AudioContext();
  
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
      MGL.decode(file).then(
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
        section.appendChild(section.filter = document.createElement('DIV'));
        section.filter.className = 'filter';
        section.filter.appendChild(section.filter.tagAdder = document.createElement('SELECT'));
        section.filter.tagAdder.appendChild(section.filter.tagAdder.placeholder = document.createElement('OPTION'));
        section.filter.tagAdder.placeholder.text = '+ filter...';
        section.filter.tagAdder.placeholder.value = '';
        section.filter.tagAdder.placeholder.disabled = true;
        section.filter.tagAdder.placeholder.selected = true;
        section.filter.tagAdder.placeholder.hidden = true;
        section.filter.tagAdder.onchange = function(e) {
          var tag = document.createElement('DIV');
          tag.className = 'tag';
          tag.innerText = this.value;
          tag.onclick = function() {
            section.filter.removeChild(this);
          };
          this.value = '';
          this.placeholder.selected = true;
          section.filter.insertBefore(tag, section.filter.edit);
        };
        section.filter.appendChild(section.filter.edit = document.createElement('INPUT'));
        section.filter.edit.onkeydown = function(e) {
          if (e.which === 8                              // backspace
          && !(this.selectionStart && this.selectionEnd) // cursor at position 0
          && this.previousElementSibling.classList.contains('tag')) { // previous sibling is tag
            section.filter.removeChild(this.previousElementSibling);
          }
        };
        section.filter.addTag = function(name, value) {
          var option = document.createElement('OPTION');
          option.text = name;
          option.value = value;
          this.tagAdder.appendChild(option);
        };
        
        section.filter.addTag('Animated', 'tag:animated');
        section.filter.addTag('Non-Animated', '-tag:animated');
        section.filter.addTag('Blended', 'tag:translucent');
        section.filter.addTag('Non-Blended', '-tag:translucent');
        section.filter.addTag('Solid', 'tag:solid');
        section.filter.addTag('Non-Solid', '-tag:solid');
        
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
            if (options[i].selected) option.selected = true;
            subsection.sorter.appendChild(option);

            var option = document.createElement('OPTION');
            option.value = '-' + options[i].value;
            option.text = String.fromCharCode(0x2193) + ' ' + options[i].text;
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
        
        function addFilter(subsection, name, options) {
          var filter;
          subsection.head.appendChild(document.createTextNode(' '));
          subsection.head.appendChild(filter = subsection[name] = document.createElement('SELECT'));
          for (var i = 0; i < options.length; i++) {
            var option = document.createElement('OPTION');
            option.value = options[i].value;
            option.text = options[i].text;
            if (options[i].selected) option.selected = true;
            filter.appendChild(option);
          }
          filter.onchange = function(e) {
            var classDiff = this.value.match(/\S+/g);
            for (var i = 0; i < classDiff.length; i++) {
              var op = classDiff[i][0], className = classDiff[i].slice(1);
              if (op === '-') subsection.classList.remove(className);
              else subsection.classList.add(className);
            }
          };
        }
        
        addFilter(section.images, 'animationMode', [
          {value:'-hide_animated -hide_static', text:'Static & Animated'},
          {value:'-hide_animated +hide_static', text:'Animated Only'},
          {value:'+hide_animated -hide_static', text:'Static Only'},
        ]);

        addFilter(section.images, 'imageMode', [
          {value:'-hide_sprites -hide_textures', text:'Textures & Sprites'},
          {value:'-hide_sprites +hide_textures', text:'Sprites Only'},
          {value:'+hide_sprites -hide_textures', text:'Textures Only'},
        ]);

        addFilter(section.images, 'matteMode', [
          {value:'-hide_translucent -hide_matte', text:'Matte & Translucent'},
          {value:'-hide_translucent +hide_matte', text:'Translucent Only'},
          {value:'+hide_translucent -hide_matte', text:'Matte Only'},
        ]);

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
            el.classList.add(header.isAnimated ? 'kind-animated' : 'kind-static');
            el.classList.add((header.flags & 0x400) ? 'kind-translucent' : 'kind-matte');
            el.image.style.width = header.width + 'px';
            el.image.style.height = header.height + 'px';
            var flags = [];
            for (var flag = 1; flag; flag <<= 1) {
              if (header.flags & flag) flags.push('0x'+flag.toString(16));
            }
            el.title += '\nFlags: ' + flags.join(', ');
            el.title += '\nUnk: ' + image.unknown.toString(16);
            el.dataset.width = header.width;
            el.dataset.height = header.height;
            el.dataset.log2h = Math.ceil(Math.log2(header.height));
            el.dataset.wxh = header.width * header.height;
            el.style.order = el.dataset.log2h;
          });
          image.getImage().then(function(imageBlob) {
            var img = document.createElement('IMG');
            img.setAttribute('width', imageBlob.width);
            img.setAttribute('height', imageBlob.height);
            img.setAttribute('src', URL.createObjectURL(imageBlob));
            el.image.appendChild(img);
            el.image.style.background = 'transparent';
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
  
  dragdrop.onclick = function(e) {
    var upload = document.createElement('INPUT');
    upload.setAttribute('type', 'file');
    upload.setAttribute('multiple', 'multiple');
    upload.setAttribute('accept', '.gdv,.mgl,.das');
    upload.style.display = 'none';
    upload.onchange = function() {
      for (var i = this.files.length - 1; i >= 0; i--) {
        onfile(this.files[i]);
      }
      this.parentNode.removeChild(this);
    };
    upload.onclick = function(e) {
      e.stopPropagation();
    };
    this.appendChild(upload);
    upload.click();
  };
  
});
