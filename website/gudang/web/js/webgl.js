/* webgl.js */
export function jalankanWebGL() {
    const c = document.getElementById("glcanvas");
    if (!c) return; // Keamanan jika canvas tidak ada

    const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
    if (!gl) {
        c.style.background = "linear-gradient(135deg,#080c16,#0d1225)";
        return;
    }

    // Fungsi resize
    // Di HP, resize kepanggil terus tiap URL bar nutup/buka. Tiap resize
    // bikin buffer GPU dialokasi ulang -> itu yang bikin scroll patah-patah.
    // Jadi resize di-debounce, dan perubahan tinggi doang (khas URL bar)
    // diabaikan karena lebarnya nggak berubah.
    let lebar = 0, tinggi = 0, timerResize = 0;

    function r() {
        const w = window.innerWidth;
        const h = window.innerHeight;

        // Lebar sama + beda tinggi masih wajar = cuma URL bar, skip.
        if (w === lebar && Math.abs(h - tinggi) < 160) return;

        lebar = w;
        tinggi = h;
        c.width = w;
        c.height = h;
        gl.viewport(0, 0, c.width, c.height);
    }

    window.addEventListener("resize", function () {
        clearTimeout(timerResize);
        timerResize = setTimeout(r, 120);
    });
    r();

    // Fungsi compile shader
    function cs(i, t) {
        const s = gl.createShader(t);
        const sourceElement = document.getElementById(i);
        if (!sourceElement) return null;
        gl.shaderSource(s, sourceElement.text);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error("Shader compile error (" + i + "):", gl.getShaderInfoLog(s));
            return null;
        }
        return s;
    }

    const v = cs("vs", gl.VERTEX_SHADER);
    const f = cs("fs", gl.FRAGMENT_SHADER);
    if (!v || !f) return;

    const p = gl.createProgram();
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error("Program link error:", gl.getProgramInfoLog(p));
        return;
    }
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
    // Loop-nya dipause kalau tab lagi nggak keliatan, biar nggak
    // ngabisin baterai + GPU buat sesuatu yang nggak dilihat siapa-siapa.
    let idFrame = 0;
    let jalan = false;

    function renderLoop() {
        const t = (performance.now() - s) * .001;
        gl.uniform3f(iR, c.width, c.height, 0);
        gl.uniform1f(iT, t);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        idFrame = requestAnimationFrame(renderLoop);
    }

    function mulai() {
        if (jalan || document.hidden) return;
        jalan = true;
        idFrame = requestAnimationFrame(renderLoop);
    }

    function berhenti() {
        if (!jalan) return;
        jalan = false;
        cancelAnimationFrame(idFrame);
        idFrame = 0;
    }

    document.addEventListener("visibilitychange", function () {
        if (document.hidden) berhenti();
        else mulai();
    });

    mulai();

    console.log("WebGL Background Started");

    // Dipakai tombol toggle background di aplikasi.js
    return { mulai: mulai, berhenti: berhenti };
}
