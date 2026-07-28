/**
 * HTML5 Canvas particle confetti burst FX engine.
 * Spawns a 60-frame colorful confetti particle explosion overlay in the desktop app UI when completing a task session.
 */
export function triggerDesktopConfetti(containerId: string = 'app-root'): void {
  const container = document.getElementById(containerId) || document.body;
  const canvas = document.createElement('canvas');
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100vw';
  canvas.style.height = '100vh';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '9999';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899', '#AAFF00'];
  const particleCount = 80;
  const particles: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    color: string;
    rotation: number;
    rotSpeed: number;
    opacity: number;
  }> = [];

  const startX = window.innerWidth / 2;
  const startY = window.innerHeight / 3;

  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: startX,
      y: startY,
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 0.7) * 14,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.2,
      opacity: 1
    });
  }

  let frameCount = 0;
  const maxFrames = 75;

  function animate() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.25; // Gravity
      p.rotation += p.rotSpeed;
      p.opacity -= 0.012;

      if (p.opacity <= 0) continue;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }

    frameCount++;
    if (frameCount < maxFrames) {
      requestAnimationFrame(animate);
    } else {
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    }
  }

  requestAnimationFrame(animate);
}
