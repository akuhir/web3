// ============================================
// MOBILE NAV TOGGLE (existing feature, unchanged)
// ============================================
const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');

if (navToggle) {
  navToggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', isOpen);
  });

  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

// ============================================
// LOADING SCREEN
// ============================================
const loader = document.getElementById('loader');
const body = document.body;

body.classList.add('gate-active');

window.addEventListener('load', () => {
  // brief minimum display so the loader doesn't just flash
  setTimeout(() => {
    if (loader) loader.classList.add('loader-hidden');
  }, 700);
});

// Fallback in case 'load' already fired or takes too long
setTimeout(() => {
  if (loader && !loader.classList.contains('loader-hidden')) {
    loader.classList.add('loader-hidden');
  }
}, 2200);

// ============================================
// GATE → PRESENTATION TRANSITION
// ============================================
const gate = document.getElementById('gate');
const presentation = document.getElementById('presentation');
const exploreBtn = document.getElementById('exploreBtn');

function enterPresentation() {
  if (!gate || !presentation) return;

  gate.classList.add('gate-exit');
  presentation.removeAttribute('aria-hidden');
  body.classList.remove('gate-active');

  requestAnimationFrame(() => {
    presentation.classList.add('presentation-visible');
  });

  // Move focus to the presentation for accessibility once visible
  setTimeout(() => {
    const firstSection = document.getElementById('introduction');
    if (firstSection) firstSection.setAttribute('tabindex', '-1');
    if (firstSection) firstSection.focus({ preventScroll: true });
    gate.setAttribute('aria-hidden', 'true');
  }, 720);
}

if (exploreBtn) {
  exploreBtn.addEventListener('click', enterPresentation);
}

// ============================================
// SCROLL PROGRESS BAR
// ============================================
const progressBar = document.getElementById('progressBar');

function updateProgress() {
  if (!progressBar || !presentation.classList.contains('presentation-visible')) return;
  const scrollTop = window.scrollY;
  const docHeight = document.documentElement.scrollHeight - window.innerHeight;
  const pct = docHeight > 0 ? Math.min(100, Math.max(0, (scrollTop / docHeight) * 100)) : 0;
  progressBar.style.width = pct + '%';
  progressBar.setAttribute('aria-valuenow', Math.round(pct));
}

window.addEventListener('scroll', updateProgress, { passive: true });
window.addEventListener('resize', updateProgress);

// ============================================
// KEYBOARD NAVIGATION (arrow keys jump between sections)
// ============================================
const sectionIds = [
  'introduction', 'definition', 'evolution', 'growth',
  'applications', 'benefits', 'challenges', 'future', 'conclusion'
];

function getCurrentSectionIndex() {
  let closestIdx = 0;
  let closestDist = Infinity;
  sectionIds.forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    const dist = Math.abs(el.getBoundingClientRect().top);
    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = i;
    }
  });
  return closestIdx;
}

function goToSection(index) {
  const clamped = Math.max(0, Math.min(sectionIds.length - 1, index));
  const el = document.getElementById(sectionIds[clamped]);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.addEventListener('keydown', (e) => {
  // If the gate is still open, Enter/Space triggers explore
  if (gate && !gate.classList.contains('gate-exit')) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      enterPresentation();
    }
    return;
  }

  if (['ArrowDown', 'ArrowRight', 'PageDown'].includes(e.key)) {
    e.preventDefault();
    goToSection(getCurrentSectionIndex() + 1);
  } else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) {
    e.preventDefault();
    goToSection(getCurrentSectionIndex() - 1);
  } else if (e.key === 'Home') {
    e.preventDefault();
    goToSection(0);
  } else if (e.key === 'End') {
    e.preventDefault();
    goToSection(sectionIds.length - 1);
  }
});

// ============================================
// TOUCH SWIPE NAVIGATION (mobile)
// ============================================
let touchStartY = 0;
let touchEndY = 0;
const SWIPE_THRESHOLD = 60;

document.addEventListener('touchstart', (e) => {
  touchStartY = e.changedTouches[0].screenY;
}, { passive: true });

document.addEventListener('touchend', (e) => {
  touchEndY = e.changedTouches[0].screenY;
  handleSwipe();
}, { passive: true });

function handleSwipe() {
  if (!presentation || !presentation.classList.contains('presentation-visible')) return;
  const delta = touchStartY - touchEndY;
  if (Math.abs(delta) < SWIPE_THRESHOLD) return;

  if (delta > 0) {
    // swiped up -> next section
    goToSection(getCurrentSectionIndex() + 1);
  } else {
    // swiped down -> previous section
    goToSection(getCurrentSectionIndex() - 1);
  }
}
