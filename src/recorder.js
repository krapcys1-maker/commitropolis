// Recording a film of a city in the browser: the tab itself (WebGL, captions, the code panel) through
// getDisplayMedia, the soundtrack mixed in from an audio element, both into one MediaRecorder file.
// MP4 where the browser can write it (it posts anywhere), WebM otherwise.

export const canRecord = () => !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined';

const TYPES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export async function recordTab(audio) {
  const screen = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30, displaySurface: 'browser' },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
  });
  const tracks = [...screen.getVideoTracks()];
  let ctx = null;
  if (audio) {
    // the soundtrack goes both to the speakers and into the film
    ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audio);
    const tap = ctx.createMediaStreamDestination();
    source.connect(ctx.destination);
    source.connect(tap);
    tracks.push(...tap.stream.getAudioTracks());
  }
  const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: type, videoBitsPerSecond: 8e6, audioBitsPerSecond: 160e3 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(1000);
  return {
    ext: type.startsWith('video/mp4') ? 'mp4' : 'webm',
    // the user can stop sharing from the browser's own bar: then the film ends early
    ended: new Promise((resolve) => screen.getVideoTracks()[0].addEventListener('ended', resolve, { once: true })),
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          screen.getTracks().forEach((t) => t.stop());
          ctx?.close();
          resolve(new Blob(chunks, { type: type || 'video/webm' }));
        };
        if (recorder.state === 'inactive') recorder.onstop();
        else recorder.stop();
      }),
  };
}
