let packs = []
let currentPage = 1
let perPage = 10

async function loadPacks(){

const res = await fetch("packs.json")
packs = await res.json()

render(packs)

}

function render(list){

const container = document.getElementById("packs")
container.innerHTML=""

const start = (currentPage - 1) * perPage
const end = start + perPage

const pageItems = list.slice(start, end)

pageItems.forEach(pack=>{

const card = document.createElement("div")
card.className="card"

card.innerHTML=`

<img src="${pack.icon}">

<div class="info">

<h3>${pack.name} by ${pack.creator}</h3>

<p>${pack.description}</p>

<p class="meta">
Version: ${pack.version} |
⬇ ${pack.downloads} downloads
</p>

<button class="download" onclick='openDownload(${JSON.stringify(pack)})'>
Download
</button>

</div>

`

container.appendChild(card)

})

renderPagination(list)

}

function openDownload(pack){

const popup = document.createElement("div")
popup.className="popup"

popup.innerHTML=`

<div class="popup-box">

<h2>${pack.name}</h2>
<img src="${pack.icon}">
<p>Choose resolution</p>

<button onclick="download('${pack.download_pc}')">
PC Resolution
</button>

<button onclick="download('${pack.download_mobile}')">
Mobile Resolution
</button>

<button onclick="closePopup()">Cancel</button>

</div>

`

document.body.appendChild(popup)

}

function closePopup(){

document.querySelector(".popup").remove()

}

function download(url){

window.open(url)

closePopup()

}

function keydownHandler(e){
if(e.key === "Escape"){
closePopup()
}
}

document.addEventListener("keydown", keydownHandler)

document.getElementById("search").addEventListener("input", function(){

const keyword = this.value.toLowerCase()

const filtered = packs.filter(pack =>
pack.name.toLowerCase().includes(keyword) ||
pack.creator.toLowerCase().includes(keyword)
)

render(filtered)

})

function renderPagination(list){

const totalPages = Math.ceil(list.length / perPage)

let nav = document.getElementById("pagination")

if(!nav){

nav = document.createElement("div")
nav.id = "pagination"
document.body.appendChild(nav)

}

nav.innerHTML = ""

if(currentPage > 1){

const prev = document.createElement("button")
prev.innerText = "Previous"

prev.onclick = () => {
currentPage--
render(list)
}

nav.appendChild(prev)

}

if(currentPage < totalPages){

const next = document.createElement("button")
next.innerText = "Next"

next.onclick = () => {
currentPage++
render(list)
}

nav.appendChild(next)

}

}
loadPacks()