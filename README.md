A simple demonstrator showing music generated using the second derivative of pixel 
differences in a video, using canvas. It uses [music generation code by Alex Bainter](https://github.com/generative-music).

# Install

Download and run samples-alex-bainter

    git clone https://github.com/generative-music/samples-alex-bainter.git
    cd samples-alex-bainter/
    npm install
    npm run-script build

(takes a while)

Clone this repo

    git clone https://github.com/libbymiller/music-foxes
    cd music-foxes

Copy over the music samples and indexes

    cp -r ../samples-alex-bainter/dist/vsco2-piano-mf .
    cp ../samples-alex-bainter/dist/index.json samples.json

Run a server

e.g.

    python -m SimpleHTTPServer 8000


# The code

The code is mostly Alex Bainter's, from here: https://github.com/generative-music

I use a lightly edited version of Alex Bainter's generative music utilities v 4.3.1:
https://github.com/generative-music/pieces-alex-bainter/tree/master/packages/utilities

Lightly edited because I'm using it without a packager (at least I think that's what's up). 
I don't need all of Alex's caching mechansims so I've just picked the bits I need.

To reproduce:

    npm install @generative-music/utilities=4.3.1

and then comment out the first line of

    node_modules/\@generative-music/utilities/dist/esm.js

like this

    //import { ToneAudioBuffer, context, ToneAudioBuffers, Sampler, Midi, intervalToFrequencyR...

and add these two lines:

    let ToneAudioBuffer = Tone.ToneAudioBuffer;
    let Sampler = Tone.Sampler;

and use the resulting file (I've called it `js/music-utils.js`)

It also uses Tone.js, e.g. 

    npm install tone.js
    cp ./node_modules/tone/build/Tone.js js/

or

    curl "https://unpkg.com/tone" > js/tone.js
