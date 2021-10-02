//import { ToneAudioBuffer, context, ToneAudioBuffers, Sampler, Midi, intervalToFrequencyRatio, Offline, ToneBufferSource, getContext, setContext, Volume } from '/node_modules/tone/build/Tone.js';

let ToneAudioBuffer = Tone.ToneAudioBuffer;
let Sampler = Tone.Sampler;

const cloneAudioBuffer = audioBuffer => {
  const clone = context.createBuffer(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  );
  for (
    let channelNumber = 0;
    channelNumber < audioBuffer.numberOfChannels;
    channelNumber += 1
  ) {
    clone.copyToChannel(
      audioBuffer.getChannelData(channelNumber),
      channelNumber
    );
  }
  return clone;
};

const createBuffer = url => {
  if (url instanceof AudioBuffer) {
    return Promise.resolve(new ToneAudioBuffer(cloneAudioBuffer(url)));
  }
  if (url instanceof ToneAudioBuffer) {
    return Promise.resolve(
      new ToneAudioBuffer(cloneAudioBuffer(url.get()))
    );
  }
  return new Promise(resolve => {
    const buffer = new ToneAudioBuffer(url, () => {
      resolve(buffer);
    });
  });
};

const createBuffers = urlMap => {
  const urls = Array.isArray(urlMap) ? urlMap : Object.values(urlMap);
  if (
    urls.every(
      url => url instanceof AudioBuffer || url instanceof ToneAudioBuffer
    )
  ) {
    return Promise.resolve(new ToneAudioBuffers(urlMap));
  }
  return new Promise(resolve => {
    const buffers = new ToneAudioBuffers(urlMap, () => {
      resolve(buffers);
    });
  });
};

const createSampler = (urlMap, opts = {}) => {
  const urls = Array.isArray(urlMap) ? urlMap : Object.values(urlMap);
  if (
    urls.every(
      url => url instanceof AudioBuffer || url instanceof ToneAudioBuffer
    )
  ) {
    return Promise.resolve(new Sampler(urlMap, opts));
  }
  return new Promise(resolve => {
    const sampler = new Sampler(
      urlMap,
      Object.assign({}, opts, {
        onload: () => resolve(sampler),
      })
    );
  });
};

//eslint-disable-next-line no-undefined
const undefinedValue = undefined;

const noop = () => undefinedValue;

// https://github.com/Tonejs/Tone.js/blob/ed0d3b08be2b95220fffe7cce7eac32a5b77580e/Tone/instrument/Sampler.ts#L183

const MAX_INTERVAL = 96;
const getClosestNote = ({ targetMidi, searchedMidiSet }) => {
  for (let interval = 0; interval <= MAX_INTERVAL; interval += 1) {
    const closestMidi = [targetMidi + interval, targetMidi - interval].find(
      midi => searchedMidiSet.has(midi)
    );
    if (typeof closestMidi !== 'undefined') {
      return closestMidi;
    }
  }
  throw new Error(`No nearby samples found for midi ${targetMidi}`);
};

const sampleNote = ({ note, sampledNotes = [], pitchShift = 0 }) => {
  const midi = Midi(note).toMidi();
  const sampledMidiSet = new Set(
    sampledNotes.map(sampledNote =>
      typeof sampledNote === 'number'
        ? sampledNote
        : Midi(sampledNote).toMidi()
    )
  );
  const closestMidi = getClosestNote({
    targetMidi: midi,
    searchedMidiSet: sampledMidiSet,
  });
  const playbackRate = intervalToFrequencyRatio(
    midi - closestMidi + pitchShift
  );
  const sampledNoteIndex = Array.from(sampledMidiSet).indexOf(closestMidi);
  const sampledNote = sampledNotes[sampledNoteIndex];
  return {
    sampledNote,
    playbackRate,
  };
};

const _createPrerenderedBuffer = async ({ createSource, duration }) => {
  let disposeSource;
  const renderedBufer = await Offline(async offlineContext => {
    const { start, dispose } = await Promise.resolve(
      createSource(offlineContext)
    );
    disposeSource = dispose;
    start();
  }, duration);
  disposeSource();
  return renderedBufer;
};

const queue = [];
const createPrerenderedBuffer = options =>
  new Promise(resolve => {
    const renderFn = async () => {
      const renderedBuffer = await _createPrerenderedBuffer(options);
      const index = queue.indexOf(renderFn);
      queue.splice(index, 1);
      resolve(renderedBuffer);
      if (queue.length > 0) {
        queue[0]();
      }
    };
    queue.push(renderFn);
    if (queue.length === 1) {
      renderFn();
    }
  });

const renderBuffer = ({
  buffer,
  getDestination,
  duration,
  bufferSourceOptions,
}) => {
  const createSource = async () => {
    const destination = await getDestination();
    const bufferSource = new ToneBufferSource(
      Object.assign({}, bufferSourceOptions, { url: buffer })
    );
    bufferSource.connect(destination);
    const start = () => {
      bufferSource.start();
    };
    const dispose = () => {
      bufferSource.dispose();
      destination.dispose();
    };
    return { start, dispose };
  };
  return createPrerenderedBuffer({ createSource, duration });
};

const createPrerenderableSampledBuffer = async ({
  note,
  samplesByNote,
  getDestination,
  additionalRenderLength,
  bufferSourceOptions = {},
  pitchShift = 0,
  reverse = false,
}) => {
  const { playbackRate, sampledNote } = sampleNote({
    note,
    pitchShift,
    sampledNotes: Object.keys(samplesByNote),
  });
  const noteBuffer = await createBuffer(samplesByNote[sampledNote]);
  noteBuffer.reverse = reverse;
  const renderedBuffer = await renderBuffer({
    getDestination,
    buffer: noteBuffer,
    duration: noteBuffer.duration / playbackRate + additionalRenderLength,
    bufferSourceOptions: Object.assign({}, bufferSourceOptions, {
      playbackRate,
    }),
  });
  noteBuffer.dispose();
  return renderedBuffer;
};

const inProgress = new Map();

const createPrerenderableSampledBuffers = async ({
  notes,
  samples,
  sampleLibrary,
  sourceInstrumentName,
  renderedInstrumentName,
  getDestination,
  additionalRenderLength = 0,
  onProgress = noop,
  bufferSourceOptions = {},
  pitchShift = 0,
  reverse = false,
} = {}) => {
  if (samples[renderedInstrumentName]) {
    return createBuffers(samples[renderedInstrumentName]);
  }
  if (inProgress.has(renderedInstrumentName)) {
    const renderedBuffersByNote = await inProgress.get(renderedInstrumentName);
    return createBuffers(renderedBuffersByNote);
  }
  const samplesByNote = samples[sourceInstrumentName];
  const promise = Promise.all(
    notes.map(async (note, i) => {
      const buffer = await createPrerenderableSampledBuffer({
        note,
        samplesByNote,
        getDestination,
        additionalRenderLength,
        bufferSourceOptions,
        pitchShift,
        reverse,
      });
      onProgress((i + 1) / notes.length);
      return buffer;
    })
  ).then(renderedBuffers =>
    renderedBuffers.reduce((o, renderedBuffer, i) => {
      const note = notes[i];
      o[note] = renderedBuffer;
      return o;
    }, {})
  );
  inProgress.set(renderedInstrumentName, promise);
  const renderedBuffersByNote = await promise;
  sampleLibrary.save([[renderedInstrumentName, renderedBuffersByNote]]);
  inProgress.delete(renderedInstrumentName);
  return createBuffers(renderedBuffersByNote);
};

const createPrerenderableSampler = async options => {
  const { notes } = options;
  const prerenderedBuffers = await createPrerenderableSampledBuffers(options);
  const prerenderedNoteMap = notes.reduce((o, note) => {
    o[note] = prerenderedBuffers.get(note);
    return o;
  }, {});
  return createSampler(prerenderedNoteMap);
};

const makeActiveStage = (deactivate, schedule) => {
  let isDeactivated = false;
  const endFns = [];

  const wrappedSchedule = () => {
    if (isDeactivated) {
      throw new Error("Can't schedule after deactivation");
    }
    if (endFns.length > 0) {
      console.warn("Rescheduling a piece that wasn't ended");
    }
    const end = schedule();
    if (typeof end !== 'function') {
      return noop;
    }
    let isEnded = false;
    const wrappedEnd = () => {
      if (isEnded) {
        return undefinedValue;
      }
      isEnded = true;
      endFns.splice(endFns.indexOf(wrappedEnd), 1);
      return end();
    };
    endFns.push(wrappedEnd);
    return wrappedEnd;
  };

  const wrappedDeactivate = () => {
    if (isDeactivated) {
      return undefinedValue;
    }
    isDeactivated = true;
    endFns.forEach(end => end());
    return deactivate();
  };

  return [wrappedDeactivate, wrappedSchedule];
};

const wrapActivate = activate => async options => {
  if (getContext() !== options.context) {
    setContext(options.context);
  }
  const [deactivate, schedule] = await activate(options);
  return makeActiveStage(deactivate, schedule);
};

const getRandomNumberBetween = (min, max) => Math.random() * (max - min) + min;

const pickRandomElement = (arr = []) =>
  arr[Math.floor(getRandomNumberBetween(0, arr.length))];

const toss = (pitchClasses = [], octaves = []) =>
  octaves.reduce(
    (notes, octave) => notes.concat(pitchClasses.map(pc => `${pc}${octave}`)),
    []
  );

const createPrerenderableBufferArray = async ({
  samples,
  sourceInstrumentName,
  renderedInstrumentName,
  sampleLibrary,
  getDestination,
  additionalRenderLength = 0,
  onProgress = noop,
  bufferSourceOptions = {},
} = {}) => {
  if (samples[renderedInstrumentName]) {
    return Promise.all(
      samples[renderedInstrumentName].map(buffer => createBuffer(buffer))
    );
  }
  const sourceBuffers = await Promise.all(
    samples[sourceInstrumentName].map(buffer => createBuffer(buffer))
  );
  const renderedBuffers = await Promise.all(
    sourceBuffers.map(async (buffer, i) => {
      const renderedBuffer = await renderBuffer({
        buffer,
        getDestination,
        bufferSourceOptions,
        duration: buffer.duration + additionalRenderLength,
      });
      buffer.dispose();
      onProgress((i + 1) / sourceBuffers.length);
      return renderedBuffer;
    })
  );
  sampleLibrary.save([[renderedInstrumentName, renderedBuffers]]);
  return renderedBuffers;
};

const createPrerenderableBuffers = async options => {
  const {
    samples,
    sourceInstrumentName,
    renderedInstrumentName,
    sampleLibrary,
    getDestination,
    additionalRenderLength = 0,
    onProgress = noop,
    bufferSourceOptions = {},
    keyFilter = () => true,
  } = options;
  if (samples[renderedInstrumentName]) {
    return createBuffers(samples[renderedInstrumentName]);
  }
  if (Array.isArray(samples[sourceInstrumentName])) {
    const bufferArray = await createPrerenderableBufferArray(options);
    return createBuffers(bufferArray);
  }
  const keys = Object.keys(samples[sourceInstrumentName]).filter(keyFilter);
  const values = keys.map(key => samples[sourceInstrumentName][key]);
  const renderedBuffers = await Promise.all(
    values.map(async (buffer, i) => {
      const renderedBuffer = await renderBuffer({
        buffer,
        getDestination,
        bufferSourceOptions,
        duration: buffer.duration + additionalRenderLength,
      });
      onProgress((i + 1) / values.length);
      return renderedBuffer;
    })
  );
  const renderedBuffersByKey = renderedBuffers.reduce(
    (o, renderedBuffer, i) => {
      const key = keys[i];
      o[key] = renderedBuffer;
      return o;
    },
    {}
  );
  sampleLibrary.save([[renderedInstrumentName, renderedBuffersByKey]]);
  return createBuffers(renderedBuffersByKey);
};

const createPitchShiftedSampler = async ({
  samplesByNote,
  pitchShift = 0,
  attack = 0,
  release = 0,
  curve = 'linear',
  volume = 0,
} = {}) => {
  let isDisposed = false;
  const output = new Volume(volume);
  const buffers = await createBuffers(samplesByNote);
  const activeSources = [];
  const sampledNotes = Object.keys(samplesByNote);

  const wrapMethodWithDisposeError = method => (...args) => {
    if (isDisposed) {
      throw Error(
        `Function ${
          method.name
        } was called after the sampler was already disposed`
      );
    }
    method(...args);
  };

  const triggerAttack = (note, time) => {
    const { sampledNote, playbackRate } = sampleNote({
      note,
      pitchShift,
      sampledNotes,
    });
    const bufferSource = new ToneBufferSource(
      buffers.get(sampledNote)
    ).connect(output);
    activeSources.push(bufferSource);
    bufferSource.set({
      playbackRate,
      curve,
      onended: () => {
        const index = activeSources.indexOf(bufferSource);
        if (index >= 0) {
          activeSources.splice(index, 1);
        }
      },
      fadeIn: attack,
      fadeOut: release,
    });
    bufferSource.start(time);
  };

  const connect = node => {
    output.connect(node);
  };

  const releaseAll = time => {
    activeSources.forEach(activeSource => {
      activeSource.set({ fadeOut: 0 });
      activeSource.stop(time);
    });
  };

  const dispose = () => {
    isDisposed = true;
    releaseAll();
    buffers.dispose();
    output.dispose();
  };

  return {
    triggerAttack: wrapMethodWithDisposeError(triggerAttack),
    connect: wrapMethodWithDisposeError(connect),
    dispose: wrapMethodWithDisposeError(dispose),
    releaseAll: wrapMethodWithDisposeError(releaseAll),
  };
};

// https://stackoverflow.com/a/2450976
const shuffle = array => {
  const newArray = array.slice();
  let currentIndex = array.length;
  let temporaryValue;
  let randomIndex;

  // While there remain elements to shuffle...
  while (currentIndex !== 0) {
    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = newArray[currentIndex];
    newArray[currentIndex] = newArray[randomIndex];
    newArray[randomIndex] = temporaryValue;
  }

  return newArray;
};

const createReverseSampler = async (urlMap, opts = {}) => {
  const buffers = await createBuffers(urlMap);
  const keys = Object.keys(urlMap);
  const reverseBuffersByKey = keys.reduce(
    (byKey, key) => {
      const buffer = ToneAudioBuffer.fromArray(buffers.get(key).toArray());
      buffer.reverse = true;
      byKey[key] = buffer;
      return byKey;
    },
    Array.isArray(urlMap) ? [] : {}
  );
  buffers.dispose();
  return createSampler(reverseBuffersByKey, opts);
};

const createPrerenderedInstrument = async ({
  createInstrument,
  notes,
  noteDuration,
  sampleLibrary,
  samples,
  renderedInstrumentName,
  onProgress = noop,
}) => {
  if (samples[renderedInstrumentName]) {
    return createSampler(samples[renderedInstrumentName]);
  }

  let renderedCount = 0;
  const noteBuffers = await Promise.all(
    notes.map(async note => {
      const createSourceForNote = async context => {
        const { instrument, dispose } = await Promise.resolve(
          createInstrument(context)
        );
        const start = () => {
          instrument.triggerAttackRelease(note, noteDuration);
        };
        return { start, dispose };
      };
      const renderedBuffer = await createPrerenderedBuffer({
        createSource: createSourceForNote,
        duration: noteDuration,
      });
      renderedCount += 1;
      onProgress(renderedCount / notes.length);
      return renderedBuffer;
    })
  );
  const noteBuffersByNote = noteBuffers.reduce((byNote, buffer, i) => {
    const note = notes[i];
    byNote[note] = buffer;
    return byNote;
  }, {});
  sampleLibrary.save([[renderedInstrumentName, noteBuffersByNote]]);
  return createSampler(noteBuffersByNote);
};

var pitchClasses = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];

const pitchClassIndiciesByValue = pitchClasses.reduce(
  (byIndex, pitchClass, index) => {
    byIndex[pitchClass] = index;
    return byIndex;
  },
  {}
);

const transposePitchClass = (pitchClass, semitones) => {
  const pitchClassIndex = pitchClassIndiciesByValue[pitchClass];
  const nextIndexForPositiveChange = (pitchClassIndex + semitones) % 12;
  if (nextIndexForPositiveChange >= 0) {
    return pitchClasses[nextIndexForPositiveChange];
  }
  return pitchClasses[nextIndexForPositiveChange + 12];
};

const getImplicitOctaveChange = (pitchClassA, pitchClassB, wasTransposedUp) => {
  const [indexA, indexB] = [pitchClassA, pitchClassB].map(
    pc => pitchClassIndiciesByValue[pc]
  );
  if (wasTransposedUp && indexA > indexB) {
    return 1;
  } else if (!wasTransposedUp && indexA < indexB) {
    return -1;
  }
  return 0;
};

const transposeNote = (pitchClass, octave, semitones) => {
  const nextPitchClass = transposePitchClass(pitchClass, semitones);
  const fullOctaveChange = Number.parseInt(semitones / 12, 10);
  const nextOctave =
    octave +
    fullOctaveChange +
    getImplicitOctaveChange(pitchClass, nextPitchClass, semitones > 0);
  return `${nextPitchClass}${nextOctave}`;
};

const TOLERANT_NOTE_REGEX = /([abcdefg])([#b]*)(\d*)/i;
const accidentalValues = {
  '#': 1,
  b: -1,
};

const normalizeNote = note => {
  const match = note.match(TOLERANT_NOTE_REGEX);
  const [, pitchClass, accidentals, octave] = match;
  const accidentalSum = accidentals
    .split('')
    .reduce((sum, accidental) => sum + accidentalValues[accidental], 0);
  if (octave.length > 0) {
    return transposeNote(
      pitchClass,
      Number.parseInt(octave, 10),
      accidentalSum
    );
  }
  return transposePitchClass(pitchClass, accidentalSum);
};

const getOctave = (note = '') => {
  const match = note.match(/[abcdefg][#b]?(\d+)/i);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
};

const getPitchClass = (note = '') => {
  const match = note.match(/([abcdefg][#b]?)\d*/i);
  if (!match) {
    return null;
  }
  return match[1];
};

var swap2 = fn => (arg1, arg2) => fn(arg2, arg1);

var curry2 = fn => arg1 => arg2 => fn(arg1, arg2);

const _transpose = (note, steps) => {
  const normalizedNote = normalizeNote(note);
  const octave = getOctave(note);
  if (octave === null) {
    const result = transposePitchClass(normalizedNote, steps);
    return result;
  }
  const pitchClass = getPitchClass(normalizedNote);
  return transposeNote(pitchClass, octave, steps);
};

const transpose = (arg1, arg2) => {
  const getResult = typeof arg1 === 'string' ? _transpose : swap2(_transpose);
  return typeof arg2 === 'undefined'
    ? curry2(getResult)(arg1)
    : getResult(arg1, arg2);
};

const chord = (tonic, intervals) =>
  [tonic].concat(intervals.map(transpose(tonic)));

const invert = (notes, inversion = 0) => {
  const inverted = notes.slice(0);
  let addFn = Array.prototype.push;
  let removeFn = Array.prototype.shift;
  let semitones = 12;
  if (inversion < 0) {
    addFn = Array.prototype.unshift;
    removeFn = Array.prototype.pop;
    semitones = -semitones;
  }
  for (let i = 0; i < Math.abs(inversion); i += 1) {
    addFn.call(inverted, transpose(removeFn.call(inverted), semitones));
  }
  return inverted;
};

var simplifyNote = transpose(0);

const _getDistance = (note1, note2) => {
  const [
    [note1PitchClassIndex, note1Octave],
    [note2PitchClassIndex, note2Octave],
  ] = [note1, note2]
    .map(normalizeNote)
    .map(note => [
      pitchClassIndiciesByValue[getPitchClass(note)],
      getOctave(note),
    ]);
  const octaveChange = note2Octave - note1Octave;
  const pitchClassChange = note2PitchClassIndex - note1PitchClassIndex;
  return pitchClassChange + octaveChange * 12;
};

const getDistance = (note1, note2) => {
  if (typeof note2 === 'undefined') {
    return curry2(_getDistance)(note1);
  }
  return _getDistance(note1, note2);
};

const sortNotes = (notes = []) =>
  notes
    .map(simplifyNote)
    .map(note => [getPitchClass(note), getOctave(note)])
    .sort((a, b) => {
      const [pcA, octA] = a;
      const [pcB, octB] = b;
      if (octA === octB || octA === null) {
        return pitchClassIndiciesByValue[pcA] - pitchClassIndiciesByValue[pcB];
      }
      return octA - octB;
    })
    .map(parts => parts.join(''));

const P1 = 0;
const d2 = 0;
const m2 = 1;
const A1 = 1;
const M2 = 2;
const d3 = 2;
const m3 = 3;
const A2 = 3;
const M3 = 4;
const d4 = 4;
const P4 = 5;
const A3 = 5;
const d5 = 6;
const A4 = 6;
const P5 = 7;
const d6 = 7;
const m6 = 8;
const A5 = 8;
const M6 = 9;
const d7 = 9;
const m7 = 10;
const A6 = 10;
const M7 = 11;
const d8 = 11;
const P8 = 12;
const A7 = 12;

const makeChord = intervals => tonic => chord(tonic, intervals);

const majorIntervals = [M3, P5];
const minorIntervals = [m3, P5];
const major7thIntervals = majorIntervals.concat(M7);
const minor7thIntervals = minorIntervals.concat(m7);
const dominant7thIntervals = majorIntervals.concat(m7);
const major9thIntervals = major7thIntervals.concat(P8 + M2);
const minor9thIntervals = minor7thIntervals.concat(P8 + M2);

const major = makeChord(majorIntervals);
const minor = makeChord(minorIntervals);
const major7th = makeChord(major7thIntervals);
const minor7th = makeChord(minor7thIntervals);
const dominant7th = makeChord(dominant7thIntervals);
const major9th = makeChord(major9thIntervals);
const minor9th = makeChord(minor9thIntervals);

export { A1, A2, A3, A4, A5, A6, A7, M2, M3, M6, M7, P1, P4, P5, P8, chord, createBuffer, createBuffers, createPitchShiftedSampler, createPrerenderableBufferArray, createPrerenderableBuffers, createPrerenderedInstrument as createPrerenderableInstrument, createPrerenderableSampledBuffers, createPrerenderableSampler, createPrerenderedBuffer, createReverseSampler, createSampler, d2, d3, d4, d5, d6, d7, d8, dominant7th, getClosestNote, getDistance, getOctave, getPitchClass, pickRandomElement as getRandomElement, getRandomNumberBetween, transpose as interval, invert, m2, m3, m6, m7, major, major7th, major9th, minor, minor7th, minor9th, renderBuffer, sampleNote, shuffle as shuffleArray, simplifyNote, sortNotes, toss, transpose, wrapActivate };
