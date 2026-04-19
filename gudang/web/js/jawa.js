/* ── Konfigurasi ── */
// Link Google Sheets CSV yang kamu berikan
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSIWy57PZw5eV1PjxjYC7gX6Haqg9aRgIlATvOCCzns8mcyIRhQkpl1vz40-GK_j4Sxlk4oOBevxBea/pub?output=csv";

/* ── State & Data ── */
// Variabel packs akan diisi otomatis setelah data dari Sheets berhasil dimuat
export let packs = [];

// Variabel pendukung untuk pagination dan filter (digunakan oleh app.js)
export let currentPage = 1, activeFilter = 'all', searchQuery = '';
export const perPage = 9;

/**
 * Fungsi Utama: jalankanJawa
 * Mengambil data dari Google Sheets dan mengubahnya menjadi array of objects.
 */
export async function jalankanJawa() {
    try {
        console.log("Memulai memuat data dari Google Sheets...");
        
        const response = await fetch(SHEET_URL);
        if (!response.ok) throw new Error("Gagal mengambil data dari Google Sheets");
        
        const csvData = await response.text();

        return new Promise((resolve, reject) => {
            // Memproses data CSV menggunakan PapaParse
            Papa.parse(csvData, {
                header: true,         // Baris pertama di Sheets dijadikan kunci (name, creator, dll)
                dynamicTyping: true,  // Otomatis mengubah "true"/"false" menjadi boolean, dan angka tetap angka
                skipEmptyLines: true, // Abaikan baris kosong di akhir sheet
                complete: function(results) {
                    packs = results.data;
                    console.log("Data berhasil dimuat. Total item:", packs.length);
                    resolve(packs);
                },
                error: function(err) {
                    console.error("Gagal parsing CSV:", err);
                    reject(err);
                }
            });
        });
    } catch (error) {
        console.error("Koneksi error atau URL tidak valid:", error);
        return []; // Kembalikan array kosong jika gagal
    }
}
