import { useState } from 'react';
import wordmark from '@/assets/brocadm-wordmark.png';
import './BroCadLogo.css';

/** Dashboard identity. The accepted lettering remains an image, including its stencil cuts. */
export function BroCadLogo() {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="brocad-logo-fallback">broCAD/M</span> :
    <span className="brocad-logo"><img src={wordmark} alt="broCAD/M" width={2172} height={724}
      onError={() => setFailed(true)} /></span>;
}
