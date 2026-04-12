/* ── Data ── */
export const packs=[
  {name:"Nova Ui",creator:"DANZGAME",description:"NOVA UI is a name derived from the word innovation, which means developing ideas in a field. A complete UI overhaul with modern design language.",icon:"../gudang/icon_logo/nova.png",version:"1.7.1",category:"ui",size:"12.4 MB",lastUpdated:"2025-01-15",download_pc:"https://github.com/DANZGAME-GD/NovaUI/releases/download/v1.7.1/NovaUi.zip",download_mobile:"downloads/nova_mobile.zip",featured:true,isNew:false},
  {name:"[BG] Hoshino",creator:"DANZGAME",description:"Background pack bertema Hoshino Aqua dari Blue Archive. Warna biru cerah dengan vibe cyberpunk yang keren.",icon:"../gudang/icon_pack/hoshino.png",version:"1.0.0",category:"background",size:"7.6 MB",lastUpdated:"2025-06-18",download_pc:"downloads/troll_pc.zip",download_mobile:"downloads/troll_mobile.zip",featured:false,isNew:true},
  {name:"[BG] Kurosaki Koyuki",creator:"DANZGAME",description:"Background pack bertema Kurosaki Koyuki. Desain minimalis dengan aesthetic yang clean dan eye-catching.",icon:"../gudang/icon_pack/kurosaki_koyuki.png",version:"1.0.0",category:"background",size:"6.9 MB",lastUpdated:"2025-06-10",download_pc:"downloads/troll_pc.zip",download_mobile:"downloads/troll_mobile.zip",featured:false,isNew:false},
  {name:"[BG] Columbina Hyposelenia",creator:"DANZGAME",description:"Background pack bertema Columbina Hyposelenia. Desain minimalis dengan aesthetic yang clean dan eye-catching.",icon:"../gudang/icon_pack/columbina_hyposelenia.png",version:"1.0.0",category:"background",size:"6.9 MB",lastUpdated:"2025-06-10",download_pc:"downloads/troll_pc.zip",download_mobile:"downloads/troll_mobile.zip",featured:false,isNew:true},
  {name:"[BG] Frieren",creator:"DANZGAME",description:"Background pack bertema anime Frieren: Beyond Journey`s End. Desain minimalis dengan aesthetic yang clean dan eye-catching.",icon:"../gudang/icon_pack/frieren.png",version:"1.0.0",category:"background",size:"6.9 MB",lastUpdated:"2025-06-10",download_pc:"downloads/troll_pc.zip",download_mobile:"downloads/troll_mobile.zip",featured:false,isNew:false}
];

// Tambahkan 'export' juga di sini karena app.js butuh variabel ini untuk filter/pagination
export let currentPage=1, activeFilter='all', searchQuery='';
export const perPage=9;

export function jalankanJawa() {
    console.log("Data loaded");
}