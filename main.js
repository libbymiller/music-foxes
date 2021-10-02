import * as ToneModule from "./js/Tone.js";
import * as Utils from './js/music-utils.js';

let data, last_data, data_diff, last_diff, double_diff;
let timeoutval = 200;

function draw() {
    let v = document.getElementById("video");
    let canvas = document.getElementById("canvas");

    if(v.paused || v.ended) return false;
    let context = canvas.getContext('2d');

    let w = canvas.width;
    let h = canvas.height;
    context.drawImage(v,0,0,w,h);

    let data = context.getImageData(0, 0, w, h)
    data_diff = makeDiff(data, last_data,w,h);
    last_data = data;
    double_diff = Math.abs(last_diff - data_diff);
    last_diff = data_diff;

    if(double_diff && double_diff>20){
      //console.log("NOTE!",double_diff);
      let note = getNote();
      piano.triggerAttackRelease(note);
    }

    setTimeout(function() {
      draw();
    }.bind(this), timeoutval);
}

function makeDiff(data1, data2,w,h){
  if(data1 && data2){
   let result = 0;

   for (var i = 0; i < data1.data.length; i += 4) {

    var ir = data1.data[i]
    var ig = data1.data[i + 1]
    var ib = data1.data[i + 2]

    var fr = data2.data[i]
    var fg = data2.data[i + 1]
    var fb = data2.data[i + 2]

    const dr = Math.abs(ir - fr) > 10 ? fr : 0
    const dg = Math.abs(ig - fg) > 10 ? fg : 0
    const db = Math.abs(ib - fb) > 10 ? fb : 0

    result = result + dr+dg+fb;
   }
   return result/(w*h);
  }else{
   return 0;
  }
}


let piano = null;
let NOTES_MAJOR = null;
const OCTAVES = [3, 4, 5];

function getNote(){
  let r = Math.floor((Math.random() * NOTES_MAJOR.length -1) + 1);
  return NOTES_MAJOR[r];
}

async function loadData(){
  const response = await fetch("/samples.json");
  const json = await response.json();
  let samples = json;

  const getPiano = samples => Utils.createSampler(samples['vsco2-piano-mf']["wav"]);
  piano = await getPiano(samples);
  NOTES_MAJOR = Utils.toss(Utils.invert(Utils.major('C'), 1), OCTAVES);

  const destination = new Tone.Meter().toDestination();
  piano.connect(destination);
  document.getElementById("message").innerHTML = "Press play!";
}

window.addEventListener('load', function() {
    console.log('All assets are loaded')
    loadData();
});

document.getElementById("video").addEventListener('play', function(){
  document.getElementById("message").innerHTML = "Now listen!";
  draw();
},false);
