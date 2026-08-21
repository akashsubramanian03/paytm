import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import jsQR from 'jsqr';
import { ScreenHeader } from '../components/AppLayout.jsx';
import Icon from '../components/Icon.jsx';
import { Avatar, Button, Field, MockBadge, cx } from '../components/primitives.jsx';
import { api, ApiError } from '../lib/api.js';
import { useToast } from '../context/ToastContext.jsx';

/**
 * Scan-to-pay. Uses the camera when the browser grants it, and always offers
 * manual entry so the flow works with no camera at all.
 */
export default function Scan() {
  const navigate = useNavigate();
  const toast = useToast();

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const resolvingRef = useRef(false);

  const [cameraState, setCameraState] = useState('idle'); // idle | starting | live | blocked
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [match, setMatch] = useState(null);

  const stopCamera = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => stopCamera, []);

  async function resolve(rawCode, { fromCamera = false } = {}) {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    setResolving(true);
    setError(null);
    try {
      const result = await api.resolveCode(rawCode);
      stopCamera();
      setCameraState('idle');
      setMatch(result.user);
      toast.success('Payee found', result.user.name);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Please try again.';
      setError(message);
      if (!fromCamera) toast.error("Couldn't read that code", message);
    } finally {
      resolvingRef.current = false;
      setResolving(false);
    }
  }

  async function startCamera() {
    setCameraState('starting');
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();
      setCameraState('live');
      tick();
    } catch {
      setCameraState('blocked');
      toast.info('Camera unavailable', 'Type or paste the code instead.');
    }
  }

  function tick() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });

    if (found?.data && !resolvingRef.current) {
      setCode(found.data);
      resolve(found.data, { fromCamera: true });
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <ScreenHeader
        title="Scan & pay"
        onBack={() => {
          stopCamera();
          navigate(-1);
        }}
      />

      <div className="space-y-4 px-4 pt-4">
        {/* ---- viewfinder ---- */}
        <div className="relative aspect-square w-full overflow-hidden rounded-card bg-navy-950">
          <video
            ref={videoRef}
            playsInline
            muted
            className={cx('h-full w-full object-cover', cameraState !== 'live' && 'hidden')}
          />
          <canvas ref={canvasRef} className="hidden" />

          {cameraState !== 'live' && (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-white">
                <Icon name={cameraState === 'blocked' ? 'alert' : 'camera'} size={28} />
              </span>
              <p className="text-[14px] leading-relaxed text-white/85">
                {cameraState === 'blocked'
                  ? 'The camera is blocked or unavailable. Enter the code below instead.'
                  : 'Point your camera at a Paytm QR code, or enter the code manually.'}
              </p>
              {cameraState !== 'blocked' && (
                <Button variant="sky" loading={cameraState === 'starting'} onClick={startCamera}>
                  <Icon name="camera" size={17} />
                  {cameraState === 'starting' ? 'Starting camera' : 'Use camera'}
                </Button>
              )}
            </div>
          )}

          {/* Framing brackets */}
          {cameraState === 'live' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative h-[62%] w-[62%]">
                {['left-0 top-0 border-l-4 border-t-4 rounded-tl-xl',
                  'right-0 top-0 border-r-4 border-t-4 rounded-tr-xl',
                  'left-0 bottom-0 border-l-4 border-b-4 rounded-bl-xl',
                  'right-0 bottom-0 border-r-4 border-b-4 rounded-br-xl',
                ].map((position) => (
                  <span key={position} className={cx('absolute h-9 w-9 border-sky', position)} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ---- manual entry ---- */}
        {match ? (
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <Avatar initials={match.initials} color={match.avatarColor} size={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15.5px] font-bold text-ink">{match.name}</p>
                <p className="truncate text-[13px] text-ink-muted">{match.upiId}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setMatch(null);
                  setCode('');
                }}
              >
                Scan another
              </Button>
              <Button onClick={() => navigate(`/pay/${match.id}`)}>Continue</Button>
            </div>
          </div>
        ) : (
          <div className="card p-4">
            <Field
              label="Or enter a code"
              name="code"
              placeholder="name@paytm, mobile number, or pay code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError(null);
              }}
              error={error}
              prefix={<Icon name="scan" size={17} />}
              hint="A Paytm UPI ID, registered mobile number, email or scanned pay code."
            />
            <Button
              className="mt-4"
              size="lg"
              full
              loading={resolving}
              disabled={code.trim().length < 3}
              onClick={() => resolve(code.trim())}
            >
              {resolving ? 'Looking up' : 'Find payee'}
            </Button>
          </div>
        )}

        <MockBadge className="pb-6">Scanning is local — codes resolve against your own database</MockBadge>
      </div>
    </div>
  );
}
