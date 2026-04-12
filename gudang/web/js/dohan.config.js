/* core.js */
import { jalankanApp } from './app.js';
import { jalankanWebGL } from './webgl.js';
import { jalankanJawa } from './jawa.js';

document.addEventListener("DOMContentLoaded", () => {
    jalankanJawa(); 
    
    jalankanWebGL();
    
    jalankanApp();
});
