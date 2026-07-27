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

    const VS_SOURCE = `attribute vec4 a_position;void main(){gl_Position=a_position;}`;
    const FS_SOURCE = `precision highp float;uniform vec3 iResolution;uniform float iTime;
const int POINTS=16;const float WO=12000.0;const float SP=1.0/12.0;const float CS=1.0/4.0;const float BR=1.1;
void voronoi(vec2 uv,inout vec3 col){vec3 v=vec3(0.0);float t=(iTime+WO)*SP;float bd=999.0;float lb=bd;
for(int i=0;i<POINTS;i++){float fi=float(i);vec2 p=vec2(mod(fi,1.0)*0.1+sin(fi),-0.05+0.15*floor(fi/10.0)+cos(fi+t*cos(uv.x*0.025)));
float d=distance(uv,p);if(d<bd){lb=bd;bd=d;v.x=p.x;v.yz=vec2(p.x*0.4+p.y,p.y)*vec2(0.9,0.87);}}
col*=vec3(0.68)+0.19*v;col+=vec3(smoothstep(0.99,1.05,1.0-abs(bd-lb))*0.85);col+=smoothstep(0.95,1.01,1.0-abs(bd-lb))*0.1*col;col+=v*0.1*smoothstep(0.5,1.0,1.0-abs(bd-lb));}
void mainImage(out vec4 f,in vec2 fc){vec2 uv=fc/iResolution.xy;vec3 c=vec3(0.5)+0.5*cos(iTime*CS+uv.xyx+vec3(0.0,2.0,4.0));voronoi(uv*4.0-vec2(1.0),c);f=vec4(c,1.0)*BR;}
void main(){mainImage(gl_FragColor,gl_FragCoord.xy);}`;

    // Fungsi compile shader
    function cs(src, t) {
        const s = gl.createShader(t);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error("Shader compile error:", gl.getShaderInfoLog(s));
            return null;
        }
        return s;
    }

    const v = cs(VS_SOURCE, gl.VERTEX_SHADER);
    const f = cs(FS_SOURCE, gl.FRAGMENT_SHADER);
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
