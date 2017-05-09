requirejs.config({
  waitSeconds: 0,
});

define([],
function() {

  'use strict';
  
  console.log('hello... newman world');
  
  var dragdrop = document.getElementById('dragdrop');
  
  function createSection() {
    var div = document.createElement('DIV');
    div.classList.add('section');
    var button = document.createElement('BUTTON');
    button.classList.add('close_button');
    button.innerText = 'X';
    button.onclick = function() {
      div.parentNode.removeChild(div);
    };
    div.appendChild(button);
    if (dragdrop.nextSibling) {
      dragdrop.parentNode.insertBefore(div, dragdrop.nextSibling);
    }
    else {
      dragdrop.parentNode.appendChild(div);
    }
    var inside = document.createElement('DIV');
    div.appendChild(inside);
    return inside;
  }
  
  function onfile(file) {
    var section = createSection();
    if (/\.gdv$/.test(file.name)) {
      section.innerText = 'video!';
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
    for (var i = 0; i < e.dataTransfer.files.length; i++) {
      onfile(e.dataTransfer.files[i]);
    }
  };
  
});
