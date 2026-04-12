/* webgl.js */
export function jalankanWebGL() {
    const c = document.getElementById("glcanvas");
    if (!c) return; // Keamanan jika canvas tidak ada
    
    const gl = c.getContext("webgl");
    if (!gl) {
        c.style.background = "linear-gradient(135deg,#080c16,#0d1225)";
        return;
    }

    // Fungsi resize
    function r() {
        c.width = window.innerWidth;
        c.height = window.innerHeight;
        gl.viewport(0, 0, c.width, c.height);
    }
    window.addEventListener("resize", r);
    r();

    // Fungsi compile shader
    function cs(i, t) {
        const s = gl.createShader(t);
        const sourceElement = document.getElementById(i);
        if (!sourceElement) return null;
        gl.shaderSource(s, sourceElement.text);
        gl.compileShader(s);
        return s;
    }

    const v = cs("vs", gl.VERTEX_SHADER);
    const f = cs("fs", gl.FRAGMENT_SHADER);
    if (!v || !f) return;

    const p = gl.createProgram();
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    gl.useProgram(p);

    const a = gl.getAttribLocation(p, "a_position");
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);

    const iR = gl.getUniformLocation(p, "iResolution");
    const iT = gl.getUniformLocation(p, "iTime");
    const s = performance.now();

    // Loop Animasi
    function renderLoop() {
        const t = (performance.now() - s) * .001;
        gl.uniform3f(iR, c.width, c.height, 0);
        gl.uniform1f(iT, t);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        requestAnimationFrame(renderLoop);
    }
    renderLoop();

    console.log("WebGL Background Started");
}
