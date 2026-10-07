(() => {
  document.documentElement.classList.add('js-motion');
  const scene = document.querySelector('#deviceScene');
  const laptop = document.querySelector('#deviceLaptop');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (scene && laptop && !reducedMotion) {
    scene.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') return;
      const rect = scene.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      laptop.style.transform = `rotateX(${2 - y * 5}deg) rotateY(${-8 + x * 9}deg) translate3d(${x * 4}px, ${y * 3}px, 0)`;
    });
    scene.addEventListener('pointerleave', () => {
      laptop.style.transform = 'rotateX(2deg) rotateY(-8deg)';
    });
  }

  const sections = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reducedMotion) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    sections.forEach((section) => observer.observe(section));
  } else {
    sections.forEach((section) => section.classList.add('is-visible'));
  }

  document.querySelectorAll('.landing-nav a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const target = document.querySelector(link.getAttribute('href'));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
    });
  });
})();
