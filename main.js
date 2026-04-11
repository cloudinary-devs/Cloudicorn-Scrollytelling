// ============================================================================
// SCROLL-D3 APP - MAIN APPLICATION FILE
// ============================================================================

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

const CONFIG = {
  // Cloudinary configuration
  CLOUDINARY: {
    BASE_URL: 'https://res.cloudinary.com/jen-demos/image/upload',
    IMAGE_ID: 'floating-cloudicorn.png'
  },
  
  // Quiz configuration
  QUIZ: {
    TOTAL_QUESTIONS: 5,
    /** Min correct answers for swag (4/5 = 80%). */
    PASSING_SCORE: 4,
    CORRECT_ANSWERS: {
      q1: 'a', // e_cartoonify
      q2: 'b', // e_brightness
      q3: 'b', // Applies an aurora borealis effect to the image
      q4: 'c', // Using slashes
      q5: 'b'  // e_background_removal
    }
  },
  
  // Starfield configuration
  STARFIELD: {
    NUM_STARS: 80,
    SCROLL_SPEED: 0.0003
  },

  /**
   * Prize challenge lab: manual URLs; submit via Netlify function → Google Sheets.
   * Override with <meta name="challenge-submit-endpoint" content="..."> if needed.
   */
  PRIZE_CHALLENGE: {
    DEFAULT_EVENT: 'DevWorld2026',
    /** Default POST target (relative works on Netlify and in `netlify dev`). */
    SUBMIT_ENDPOINT: '/.netlify/functions/submit-challenge',
    EVENT_LABELS: {
      devworld: 'DevWorld',
      demo: 'Local / dev (legacy)',
      wearedevs2026: 'WeAreDevs2026'
    },
    TASKS: [
      {
        id: 'generativeBackgroundReplace',
        validator: 'generativeBackgroundReplacePrompt',
        title: 'Task 1: Generative background replace (prompted)',
        description:
          'Use generative background replace with a natural-language prompt (e.g. e_gen_background_replace:prompt_your%20idea). Your URL must include e_gen_background_replace, prompt_, f_auto, and q_auto. See “Using a prompt” in the docs.',
        docsUrl:
          'https://cloudinary.com/documentation/generative_ai_transformations#generative_background_replace'
      },
      {
        id: 'generativeReplace',
        validator: 'generativeReplacePrompt',
        title: 'Task 2: Generative replace (prompted)',
        description:
          'Use generative replace with explicit from and to prompts (e_gen_replace:from_…;to_…). Your URL must include e_gen_replace, both from_ and to_, plus f_auto and q_auto. Hint: try replacing the balloon.',
        docsUrl:
          'https://cloudinary.com/documentation/generative_ai_transformations#generative_replace'
      }
    ]
  }
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// URL parameter utilities
const URLUtils = {
  getParameter: (name) => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
  },
  
  hasParameter: (name, value) => {
    const param = URLUtils.getParameter(name);
    return param === value || param === '1';
  },

  /** Merge query params and update the address bar without reload. */
  setSearchParams: (updates) => {
    const params = new URLSearchParams(window.location.search);
    Object.entries(updates).forEach(([key, val]) => {
      if (val === null || val === undefined || val === '') {
        params.delete(key);
      } else {
        params.set(key, String(val));
      }
    });
    const qs = params.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.pushState({}, '', next);
  }
};

// ============================================================================
// PRIZE CHALLENGE LAB (URL validation + optional spreadsheet submit)
// ============================================================================

const CHALLENGE_VALIDATORS = {
  generativeBackgroundReplacePrompt: (normalizedChain) =>
    /e_gen_background_replace/.test(normalizedChain) &&
    /prompt_/.test(normalizedChain) &&
    /f_auto/.test(normalizedChain) &&
    /q_auto/.test(normalizedChain),
  generativeReplacePrompt: (normalizedChain) =>
    /e_gen_replace/.test(normalizedChain) &&
    /from_/.test(normalizedChain) &&
    /to_/.test(normalizedChain) &&
    /f_auto/.test(normalizedChain) &&
    /q_auto/.test(normalizedChain)
};

const ChallengeLab = {
  state: { valid: [false, false] },

  updatePrizeLabVisibility: () => {
    const lab = document.getElementById('prize-lab');
    if (!lab) return;
    if (URLUtils.hasParameter('challenge', 'true')) {
      lab.classList.remove('hidden');
    } else {
      lab.classList.add('hidden');
    }
  },

  getSubmitEndpoint: () => {
    const meta = document.querySelector('meta[name="challenge-submit-endpoint"]');
    if (meta && meta.content && meta.content.trim()) return meta.content.trim();
    return CONFIG.PRIZE_CHALLENGE.SUBMIT_ENDPOINT || '';
  },

  getCloudName: () => {
    try {
      const u = new URL(CONFIG.CLOUDINARY.BASE_URL);
      return u.pathname.split('/').filter(Boolean)[0] || 'jen-demos';
    } catch {
      return 'jen-demos';
    }
  },

  normalizeChain: (chain) => {
    if (!chain) return '';
    return chain
      .toLowerCase()
      .split('/')
      .filter((seg) => seg && !/^v\d+$/.test(seg))
      .join('/');
  },

  extractChainFromUrl: (urlString) => {
    const cloud = ChallengeLab.getCloudName();
    const publicFile = CONFIG.CLOUDINARY.IMAGE_ID;
    try {
      const u = new URL(urlString.trim());
      if (!u.hostname.endsWith('cloudinary.com')) {
        return { ok: false, error: 'Use a Cloudinary delivery URL (e.g. res.cloudinary.com).' };
      }
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] !== cloud) {
        return { ok: false, error: `Cloud must be "${cloud}" (this demo’s asset).` };
      }
      const uploadIdx = parts.indexOf('upload');
      if (uploadIdx < 0) {
        return { ok: false, error: 'Path must include /image/upload/.' };
      }
      let rest = parts.slice(uploadIdx + 1);
      if (rest[0] && /^v\d+$/.test(rest[0])) {
        rest = rest.slice(1);
      }
      if (rest.length < 2) {
        return { ok: false, error: 'Missing transformations or public ID.' };
      }
      const lastSeg = rest[rest.length - 1];
      if (lastSeg.toLowerCase() !== publicFile.toLowerCase()) {
        return { ok: false, error: `Public ID must be "${publicFile}".` };
      }
      const chain = rest.slice(0, -1).join('/');
      return { ok: true, chain };
    } catch {
      return { ok: false, error: 'Invalid URL.' };
    }
  },

  validateTask: (taskIndex, urlString) => {
    const task = CONFIG.PRIZE_CHALLENGE.TASKS[taskIndex];
    if (!task) return { ok: false, error: 'Unknown task.' };
    const parsed = ChallengeLab.extractChainFromUrl(urlString);
    if (!parsed.ok) return parsed;
    const n = ChallengeLab.normalizeChain(parsed.chain);
    const key = task.validator || task.id;
    const fn = CHALLENGE_VALIDATORS[key];
    if (!fn) return { ok: false, error: 'No validator for this task.' };
    if (!fn(n)) {
      return {
        ok: false,
        error: 'Does not match this task. Compare your transformation chain to the docs.'
      };
    }
    return { ok: true, chain: n };
  },

  renderTaskCopy: () => {
    CONFIG.PRIZE_CHALLENGE.TASKS.forEach((task, i) => {
      const idx = i + 1;
      const titleEl = document.getElementById(`prize-task-${idx}-title`);
      const descEl = document.getElementById(`prize-task-${idx}-desc`);
      const docsEl = document.getElementById(`prize-task-${idx}-docs`);
      if (titleEl) titleEl.textContent = task.title;
      if (descEl) descEl.textContent = task.description;
      if (docsEl && task.docsUrl) {
        docsEl.href = task.docsUrl;
        docsEl.classList.remove('hidden');
      }
    });
  },

  /** Base delivery URL (no transforms) — same string users copy to extend with AI effects. */
  renderStarterUrl: () => {
    const url = CloudinaryEngine.generateUrl('');
    const el = document.getElementById('prize-starter-url');
    if (el) el.textContent = url;
  },

  copyStarterUrl: async () => {
    const el = document.getElementById('prize-starter-url');
    const text = el?.textContent?.trim() || '';
    const feedback = document.getElementById('prize-copy-starter-feedback');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (feedback) {
        feedback.textContent = 'Copied!';
        feedback.className = 'text-xs text-green-400 mt-2 min-h-[1rem]';
        setTimeout(() => {
          if (feedback) feedback.textContent = '';
        }, 2500);
      }
    } catch {
      if (feedback) {
        feedback.textContent = 'Clipboard blocked — select the URL and copy manually.';
        feedback.className = 'text-xs text-amber-400 mt-2 min-h-[1rem]';
      }
    }
  },

  syncEventDisplay: () => {
    const raw = URLUtils.getParameter('event') || CONFIG.PRIZE_CHALLENGE.DEFAULT_EVENT;
    const label =
      CONFIG.PRIZE_CHALLENGE.EVENT_LABELS[raw] || raw || CONFIG.PRIZE_CHALLENGE.DEFAULT_EVENT;
    const el = document.getElementById('prize-event-display');
    if (el) {
      el.textContent = label;
      el.dataset.eventId = raw || '';
    }
    const sub = document.getElementById('prize-submit-hint');
    if (sub) {
      sub.textContent = ChallengeLab.getSubmitEndpoint()
        ? 'Submit unlocks only after both Check URL steps pass. Rows are written by the Netlify function (configure Google Sheets env vars on Netlify).'
        : 'Set CONFIG.PRIZE_CHALLENGE.SUBMIT_ENDPOINT or the challenge-submit-endpoint meta tag.';
    }
  },

  setStatus: (index, ok, message) => {
    const el = document.getElementById(`prize-status-${index + 1}`);
    if (!el) return;
    el.textContent = message;
    el.className =
      'text-sm mt-2 ' +
      (ok === null ? 'text-gray-400' : ok ? 'text-green-400 font-medium' : 'text-red-400');
    if (ok !== null) {
      ChallengeLab.state.valid[index] = !!ok;
    }
    ChallengeLab.updateSubmitButtonState();
  },

  updateSubmitButtonState: () => {
    const btn = document.getElementById('prize-submit');
    if (!btn) return;
    const ready = ChallengeLab.state.valid[0] && ChallengeLab.state.valid[1];
    btn.disabled = !ready;
  },

  setPreviewLoading: (taskIndex, show) => {
    const loader = document.getElementById(`prize-preview-loader-${taskIndex + 1}`);
    if (!loader) return;
    if (show) {
      loader.classList.remove('opacity-0', 'pointer-events-none');
      loader.classList.add('opacity-100');
    } else {
      loader.classList.add('opacity-0', 'pointer-events-none');
      loader.classList.remove('opacity-100');
    }
  },

  handleCheck: (taskIndex) => {
    const input = document.getElementById(`prize-url-${taskIndex + 1}`);
    const preview = document.getElementById(`prize-preview-${taskIndex + 1}`);
    const url = input ? input.value.trim() : '';
    if (!url) {
      ChallengeLab.setStatus(taskIndex, false, 'Paste a full Cloudinary URL first.');
      if (preview) {
        preview.removeAttribute('src');
        preview.classList.add('hidden');
      }
      ChallengeLab.setPreviewLoading(taskIndex, false);
      return;
    }
    const result = ChallengeLab.validateTask(taskIndex, url);
    if (!result.ok) {
      ChallengeLab.setStatus(taskIndex, false, result.error);
      if (preview) {
        preview.removeAttribute('src');
        preview.classList.add('hidden');
      }
      ChallengeLab.setPreviewLoading(taskIndex, false);
      return;
    }
    ChallengeLab.setStatus(taskIndex, true, 'Looks correct — loading preview…');
    if (preview) {
      preview.classList.add('hidden');
      ChallengeLab.setPreviewLoading(taskIndex, true);

      const finishLoad = () => {
        preview.onload = null;
        preview.onerror = null;
        ChallengeLab.setPreviewLoading(taskIndex, false);
      };

      preview.onload = () => {
        finishLoad();
        preview.classList.remove('hidden');
        preview.alt = `Preview task ${taskIndex + 1}`;
        ChallengeLab.setStatus(taskIndex, true, 'Looks correct for this task.');
      };

      preview.onerror = () => {
        finishLoad();
        preview.classList.add('hidden');
        ChallengeLab.setStatus(taskIndex, false, 'Image failed to load. Check the URL.');
      };

      preview.src = '';
      preview.src = url;
    }
  },

  handleSubmit: async (event) => {
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    const endpoint = ChallengeLab.getSubmitEndpoint();
    const statusEl = document.getElementById('prize-submit-status');
    const form = document.getElementById('prize-challenge-form');
    if (form && !form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const firstNameEl = document.getElementById('prize-first-name');
    const lastNameEl = document.getElementById('prize-last-name');
    const emailEl = document.getElementById('prize-email');
    const firstName = firstNameEl ? firstNameEl.value.trim() : '';
    const lastName = lastNameEl ? lastNameEl.value.trim() : '';
    const email = emailEl ? emailEl.value.trim() : '';

    const simpleEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!simpleEmail.test(email)) {
      if (statusEl) {
        statusEl.textContent = 'Enter a valid email address.';
        statusEl.className = 'text-sm mt-2 text-red-400';
      }
      return;
    }

    const url1 = document.getElementById('prize-url-1')?.value.trim() || '';
    const url2 = document.getElementById('prize-url-2')?.value.trim() || '';
    const v1 = ChallengeLab.validateTask(0, url1);
    const v2 = ChallengeLab.validateTask(1, url2);
    if (!v1.ok) {
      if (statusEl) {
        statusEl.textContent = `Task 1: ${v1.error}`;
        statusEl.className = 'text-sm mt-2 text-red-400';
      }
      return;
    }
    if (!v2.ok) {
      if (statusEl) {
        statusEl.textContent = `Task 2: ${v2.error}`;
        statusEl.className = 'text-sm mt-2 text-red-400';
      }
      return;
    }

    if (!endpoint) {
      if (statusEl) {
        statusEl.textContent =
          'Submit endpoint not configured. Set meta challenge-submit-endpoint or CONFIG.PRIZE_CHALLENGE.SUBMIT_ENDPOINT.';
        statusEl.className = 'text-sm mt-2 text-amber-400';
      }
      return;
    }

    const eventId = URLUtils.getParameter('event') || CONFIG.PRIZE_CHALLENGE.DEFAULT_EVENT;
    const eventLabel =
      CONFIG.PRIZE_CHALLENGE.EVENT_LABELS[eventId] || eventId || CONFIG.PRIZE_CHALLENGE.DEFAULT_EVENT;

    const payload = {
      event: eventId,
      eventName: eventLabel,
      firstName,
      lastName,
      email,
      url1,
      url2
    };

    if (statusEl) {
      statusEl.textContent = 'Submitting…';
      statusEl.className = 'text-sm mt-2 text-gray-300';
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = text || res.statusText;
        try {
          const j = JSON.parse(text);
          if (j.error) msg = j.detail ? `${j.error}: ${j.detail}` : j.error;
        } catch {
          /* use raw text */
        }
        throw new Error(msg);
      }
      if (statusEl) {
        statusEl.textContent = 'Submitted. Thank you!';
        statusEl.className = 'text-sm mt-2 text-green-400';
      }
    } catch (err) {
      if (statusEl) {
        statusEl.textContent =
          'Submit failed. Use netlify dev with env vars, or check Netlify function logs. ' +
          (err.message || '');
        statusEl.className = 'text-sm mt-2 text-red-400';
      }
    }
  },

  init: () => {
    ChallengeLab.renderStarterUrl();
    ChallengeLab.renderTaskCopy();
    ChallengeLab.syncEventDisplay();
    document.getElementById('prize-copy-starter-url')?.addEventListener('click', ChallengeLab.copyStarterUrl);
    document.getElementById('prize-check-1')?.addEventListener('click', () => ChallengeLab.handleCheck(0));
    document.getElementById('prize-check-2')?.addEventListener('click', () => ChallengeLab.handleCheck(1));
    document.getElementById('prize-challenge-form')?.addEventListener('submit', ChallengeLab.handleSubmit);
    [0, 1].forEach((i) => {
      document.getElementById(`prize-url-${i + 1}`)?.addEventListener('input', () => {
        ChallengeLab.state.valid[i] = false;
        ChallengeLab.setStatus(i, null, 'Edited — click Check URL again.');
        const preview = document.getElementById(`prize-preview-${i + 1}`);
        if (preview) {
          preview.removeAttribute('src');
          preview.classList.add('hidden');
        }
        ChallengeLab.setPreviewLoading(i, false);
      });
    });
    ChallengeLab.updateSubmitButtonState();
  }
};

// DOM utilities
const DOMUtils = {
  select: (selector) => document.querySelector(selector),
  selectAll: (selector) => document.querySelectorAll(selector),
  createElement: (tag, className = '') => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    return element;
  }
};

// ============================================================================
// CLOUDINARY TRANSFORMATION ENGINE
// ============================================================================

const CloudinaryEngine = {
  // Generate base Cloudinary URL
  generateUrl: (transformations = '') => {
    const { BASE_URL, IMAGE_ID } = CONFIG.CLOUDINARY;
    return transformations.trim() 
      ? `${BASE_URL}/${transformations}/${IMAGE_ID}`
      : `${BASE_URL}/${IMAGE_ID}`;
  },

  // Generate responsive image URLs
  generateResponsiveUrls: (transformations = '') => {
    const baseTransform = transformations ? `${transformations}/` : '';
    const { BASE_URL, IMAGE_ID } = CONFIG.CLOUDINARY;
    
    return {
      small: `${BASE_URL}/${baseTransform}w_300/${IMAGE_ID}`,
      medium: `${BASE_URL}/${baseTransform}w_600/${IMAGE_ID}`,
      large: `${BASE_URL}/${baseTransform}w_900/${IMAGE_ID}`,
      xlarge: `${BASE_URL}/${baseTransform}w_1200/${IMAGE_ID}`
    };
  },

  // Update image with responsive srcset
  updateImageWithSrcset: (imgElement, transformations) => {
    const urls = CloudinaryEngine.generateResponsiveUrls(transformations);
    const srcset = `${urls.small} 300w, ${urls.medium} 600w, ${urls.large} 900w, ${urls.xlarge} 1200w`;
    
    d3.select(imgElement)
      .attr('srcset', srcset)
      .attr('sizes', 'auto, (max-width: 600px) 300px, (max-width: 900px) 600px, (max-width: 1200px) 900px, 1200px')
      .attr('width', 813)
      .attr('height', 813)
      .attr('loading', 'lazy')
      .attr('src', urls.medium);
  },

  // Validate transformation parameters
  validateTransformations: (transformations) => {
    if (!transformations || transformations.trim() === '') {
      return { isValid: true, message: '' };
    }
    
    const validParams = [
      'e_', 'c_', 'w_', 'h_', 'g_', 'f_', 'q_', 'dpr_', 'o_', 'r_', 'b_', 'bo_', 'co_', 'a_', 'fl_'
    ];
    
    const params = transformations.split('/').flatMap(t => t.split(','));
    const invalidParams = params.filter(param => {
      const trimmed = param.trim();
      return trimmed && !validParams.some(valid => trimmed.startsWith(valid));
    });
    
    if (invalidParams.length > 0) {
      return { 
        isValid: false, 
        message: `Invalid parameters: ${invalidParams.join(', ')}. Please check Cloudinary documentation.` 
      };
    }
    
    return { isValid: true, message: '' };
  }
};

// ============================================================================
// URL BREAKDOWN DISPLAY SYSTEM
// ============================================================================

const URLBreakdown = {
  // Create URL breakdown with colors
  createBreakdown: (baseUrl, transformations, imageId, options = {}) => {
    const {
      baseUrlClass = 'text-blue-400',
      transformationClass = 'text-black bg-yellow-300 font-semibold rounded-md px-1',
      imageIdClass = 'text-blue-400',
      baseUrlText = 'https://res.cloudinary.com/jen-demos/image/upload/',
      imageIdText = '/floating-cloudicorn.png',
      transformationText = 'f_auto/q_auto'
    } = options;
    
    const finalBaseUrl = baseUrl || baseUrlText;
    const finalImageId = imageId || imageIdText;
    const finalTransformations = transformations || transformationText;
    
    return `
      <span class="${baseUrlClass}">${finalBaseUrl}</span><span class="${transformationClass}">${finalTransformations}</span><span class="${imageIdClass}">${finalImageId}</span>
    `;
  },

  // Update URL breakdown display
  updateDisplay: (container, baseUrl, transformations, imageId, options = {}) => {
    const html = URLBreakdown.createBreakdown(baseUrl, transformations, imageId, options);
    d3.select(container).html(html);
  },

  // Initialize all URL breakdowns
  initializeAll: () => {
    d3.selectAll('.step').each(function() {
      const step = d3.select(this);
      const transform = step.attr('data-transform');
      const urlBreakdown = step.select('.url-breakdown');
      
      if (transform && urlBreakdown.size() > 0) {
        URLBreakdown.updateDisplay(urlBreakdown.node(), null, transform, null);
      }
    });
  }
};

// ============================================================================
// STARFIELD ANIMATION SYSTEM
// ============================================================================

const Starfield = {
  canvas: null,
  ctx: null,
  stars: [],
  
  init: () => {
    Starfield.canvas = d3.select('#starfield').node();
    Starfield.ctx = Starfield.canvas.getContext('2d');
    Starfield.createStars();
    Starfield.setupResize();
    Starfield.animate();
  },

  createStars: () => {
    Starfield.stars = [];
    for (let i = 0; i < CONFIG.STARFIELD.NUM_STARS; i++) {
      Starfield.stars.push({
        x: Math.random() * Starfield.canvas.width,
        y: Math.random() * Starfield.canvas.height,
        z: Math.random() * 1000,
        size: Math.random() * 1 + 0.5,
        speed: Math.random() * 0.2 + 0.05
      });
    }
  },

  setupResize: () => {
    const resizeCanvas = () => {
      Starfield.canvas.width = window.innerWidth;
      Starfield.canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
  },

  animate: () => {
    Starfield.ctx.clearRect(0, 0, Starfield.canvas.width, Starfield.canvas.height);
    
    const scrollY = window.scrollY;
    const scrollSpeed = scrollY * CONFIG.STARFIELD.SCROLL_SPEED;
    
    Starfield.stars.forEach(star => {
      star.z -= star.speed + scrollSpeed;
      
      if (star.z < 1) {
        star.z = 1000;
        star.x = Math.random() * Starfield.canvas.width;
        star.y = Math.random() * Starfield.canvas.height;
      }
      
      const x = (star.x - Starfield.canvas.width / 2) * (1000 / star.z) + Starfield.canvas.width / 2;
      const y = (star.y - Starfield.canvas.height / 2) * (1000 / star.z) + Starfield.canvas.height / 2;
      const size = star.size * (1000 / star.z);
      
      if (x > 0 && x < Starfield.canvas.width && y > 0 && y < Starfield.canvas.height) {
        Starfield.ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.6, 1000 / star.z * 0.3)})`;
        Starfield.ctx.beginPath();
        Starfield.ctx.arc(x, y, size, 0, Math.PI * 2);
        Starfield.ctx.fill();
        
        if (star.z < 100) {
          Starfield.ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 * (1000 / star.z)})`;
          Starfield.ctx.lineWidth = size * 0.3;
          Starfield.ctx.beginPath();
          Starfield.ctx.moveTo(x, y);
          Starfield.ctx.lineTo(x + (x - Starfield.canvas.width / 2) * 0.05, y + (y - Starfield.canvas.height / 2) * 0.05);
          Starfield.ctx.stroke();
        }
      }
    });
    
    requestAnimationFrame(Starfield.animate);
  }
};

// ============================================================================
// IMAGE TRANSITION SYSTEM
// ============================================================================

const ImageTransitions = {
  // Handle image transitions with responsive support
  handleTransition: (imgElement, imgUrl, transform, isFirstImage = false) => {
    const imgContainer = d3.select(imgElement.parentNode);
    const loader = imgContainer.select('.section-image-loader, #main-image-loader, #custom-image-loader');
    
    if (isFirstImage) {
      const urls = CloudinaryEngine.generateResponsiveUrls(transform);
      const srcset = `${urls.small} 300w, ${urls.medium} 600w, ${urls.large} 900w, ${urls.xlarge} 1200w`;
      
      d3.select(imgElement)
        .attr('srcset', srcset)
        .attr('sizes', 'auto, (max-width: 600px) 300px, (max-width: 900px) 600px, (max-width: 1200px) 900px, 1200px')
        .attr('width', 813)
        .attr('height', 813)
        .attr('loading', 'lazy')
        .transition()
        .duration(800)
        .style('opacity', 1)
        .style('transform', 'scale(1) rotate(0deg)')
        .style('filter', 'blur(0px) brightness(1)');
    } else {
      loader.style('opacity', 1);
      
      d3.select(imgElement)
        .transition()
        .duration(400)
        .style('opacity', 0)
        .style('transform', 'scale(0.8) rotate(-5deg)')
        .style('filter', 'blur(8px) brightness(0.5)')
        .on('end', function() {
          const urls = CloudinaryEngine.generateResponsiveUrls(transform);
          const srcset = `${urls.small} 300w, ${urls.medium} 600w, ${urls.large} 900w, ${urls.xlarge} 1200w`;
          
          d3.select(imgElement)
            .attr('srcset', srcset)
            .attr('sizes', 'auto, (max-width: 600px) 300px, (max-width: 900px) 600px, (max-width: 1200px) 900px, 1200px')
            .attr('width', 813)
            .attr('height', 813)
            .attr('loading', 'lazy')
            .attr('src', urls.medium);
          
          d3.select(imgElement)
            .style('opacity', 0)
            .style('transform', 'scale(1.2) rotate(5deg)')
            .style('filter', 'blur(8px) brightness(1.5)');
          
          d3.select(imgElement)
            .transition()
            .duration(600)
            .style('opacity', 1)
            .style('transform', 'scale(1) rotate(0deg)')
            .style('filter', 'blur(0px) brightness(1)')
            .on('end', function() {
              loader.style('opacity', 0);
              
              d3.select(imgElement)
                .transition()
                .duration(200)
                .style('transform', 'scale(1.05)')
                .transition()
                .duration(200)
                .style('transform', 'scale(1)');
            });
        });
    }
  },

  // Update custom image with responsive handling
  updateCustomImage: (transformations) => {
    const customImage = d3.select('#custom-image');
    const customImageLoader = d3.select('#custom-image-loader');
    
    const url = CloudinaryEngine.generateUrl(transformations);
    URLBreakdown.updateDisplay('#generated-url-breakdown', null, transformations, null);
    
    customImageLoader.style('opacity', 1);
    
    customImage
      .transition()
      .duration(300)
      .style('opacity', 0)
      .on('end', function() {
        CloudinaryEngine.updateImageWithSrcset(this, transformations);
        d3.select(this)
          .transition()
          .duration(300)
          .style('opacity', 1)
          .on('end', function() {
            customImageLoader.style('opacity', 0);
          });
      });
  }
};

// ============================================================================
// INTERSECTION OBSERVER SYSTEM
// ============================================================================

const IntersectionObserver = {
  observer: null,
  isDesktop: window.innerWidth >= 1024,
  
  init: () => {
    const steps = d3.selectAll('.step');
    const mainImage = d3.select('#main-image');
    
    IntersectionObserver.observer = new window.IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          steps.classed('active', false);
          const step = d3.select(entry.target);
          step.classed('active', true);
          
          const transform = step.attr('data-transform');
          if (transform) {
            const imgUrl = CloudinaryEngine.generateUrl(transform);
            
            if (IntersectionObserver.isDesktop && mainImage.node()) {
              const currentSrc = mainImage.attr('src');
              const isFirstImage = !currentSrc || currentSrc === imgUrl;
              ImageTransitions.handleTransition(mainImage.node(), imgUrl, transform, isFirstImage);
            } else {
              const stepImage = step.select('.section-image');
              if (stepImage.node()) {
                const currentOpacity = d3.select(stepImage.node()).style('opacity');
                const isFirstImage = currentOpacity === '0' || currentOpacity === '';
                ImageTransitions.handleTransition(stepImage.node(), imgUrl, transform, isFirstImage);
              }
            }
          }
        }
      });
    }, {
      threshold: 0.6,
      rootMargin: '0px 0px -15% 0px'
    });

    steps.nodes().forEach(step => IntersectionObserver.observer.observe(step));
    
    if (IntersectionObserver.isDesktop && mainImage.node()) {
      mainImage
        .transition()
        .duration(1000)
        .style('opacity', 1);
    }
  }
};

// ============================================================================
// SECTIONS GENERATION SYSTEM
// ============================================================================

const SectionsGenerator = {
  // Sections data - single source of truth for all transformations
  sectionsData: [
    {
      index: 0,
      transform: 'f_auto/q_auto',
      title: 'Optimized!',
      description: 'This image was 726kb, now it\'s 77kb! It\'s now 89% smaller!',
      alt: 'Optimized'
    },
    {
      index: 1,
      transform: 'e_background_removal/f_auto/q_auto',
      title: 'Background Removal',
      description: 'Space can feel isolating, so let\'s remove the background to make it feel more like home.',
      alt: 'Background Removal'
    },
    {
      index: 2,
      transform: 'e_gen_recolor:prompt_space_suit;to-color_pink/e_background_removal/f_auto/q_auto',
      title: 'Generative Colorize',
      description: 'Let\'s reinvent myself!',
      alt: 'Generative Colorize'
    },
    {
      index: 3,
      transform: 'e_art:aurora/e_background_removal/f_auto/q_auto',
      title: 'Aurora Effect',
      description: 'Woah! Solar flare!',
      alt: 'Aurora Effect'
    },
    {
      index: 4,
      transform: 'e_background_removal/o_20/f_auto/q_auto',
      title: 'Opacity',
      description: 'I\'m feeling faint!',
      alt: 'Opacity'
    },
    {
      index: 5,
      transform: 'e_gen_background_replace/f_auto/q_auto',
      title: 'Generative Background Replace',
      description: 'Where am I?',
      alt: 'Generative Background Replace'
    },
    {
      index: 6,
      transform: 'e_pixelate:15/e_background_removal/f_auto/q_auto',
      title: 'Pixelate',
      description: 'I feel like going incognito. Let\'s add some pixels.',
      alt: 'Pixelate'
    }
  ],

  // Generate section HTML
  generateSectionHTML: (section) => {
    return `
      <section class="step bg-transparent rounded-xl p-6 lg:p-8 min-h-64 lg:min-h-64 flex flex-col lg:flex-row items-center justify-center transition-all duration-300" 
               data-index="${section.index}" data-transform="${section.transform}">
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between w-full lg:max-w-6xl">
          <div class="w-full max-w-sm lg:max-w-md mx-auto mb-6 lg:mb-0 lg:flex-1 lg:pr-8">
            <div class="text-center">
              <div class="relative">
                <img class="section-image w-full rounded-xl object-cover opacity-0" 
                     alt="${section.alt}">
                <div class="section-image-loader absolute inset-0 bg-gray-900/80 rounded-xl flex items-center justify-center opacity-0 transition-opacity duration-300 pointer-events-none">
                  <div class="text-center">
                    <div class="animate-spin rounded-full h-8 w-8 lg:h-12 lg:w-12 border-b-2 border-purple-500 mx-auto mb-2 lg:mb-4"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="lg:pl-8">
            <div class="text text-lg text-gray-300 text-center lg:text-left max-w-2xl">
              <h2 class="text-2xl font-bold text-white mb-4">${section.title}</h2>
              <p class="text-gray-300 leading-relaxed mb-4">${section.description}</p>
              <div class="url-breakdown bg-gray-800/50 px-3 py-2 rounded text-sm sm:text-base leading-relaxed"></div>
            </div>
          </div>
        </div>
      </section>
    `;
  },

  // Generate all sections
  generateAll: () => {
    const scrollyContainer = d3.select('#scrolly-container');
    scrollyContainer.selectAll('.step').remove();
    
    SectionsGenerator.sectionsData.forEach(section => {
      const sectionHTML = SectionsGenerator.generateSectionHTML(section);
      scrollyContainer.append('div').html(sectionHTML);
    });
  },

  // Initialize all images
  initializeImages: () => {
    const mainImage = d3.select('#main-image');
    const mainImageUrl = CloudinaryEngine.generateUrl('f_auto/q_auto');
    mainImage.attr('src', mainImageUrl);
    mainImage.style('opacity', 1);
    
    const customImage = d3.select('#custom-image');
    const customImageUrl = CloudinaryEngine.generateUrl('');
    customImage.attr('src', customImageUrl);
    customImage.style('opacity', 1);
    
    d3.selectAll('.step').each(function() {
      const step = d3.select(this);
      const transform = step.attr('data-transform');
      const sectionImage = step.select('.section-image');
      
      if (transform && sectionImage.size() > 0) {
        const imageUrl = CloudinaryEngine.generateUrl(transform);
        sectionImage.attr('src', imageUrl);
        sectionImage.style('opacity', 1);
      }
    });
  }
};

// ============================================================================
// INTERACTIVE TRANSFORMATION SYSTEM
// ============================================================================

const InteractiveTransformations = {
  init: () => {
    const transformationInput = d3.select('#transformation-input');
    const applyButton = d3.select('#apply-transform');
    const exampleButtons = d3.selectAll('.example-btn');

    // Handle Apply button click with validation
    applyButton.on('click', function() {
      const transformations = transformationInput.property('value');
      const validation = CloudinaryEngine.validateTransformations(transformations);
      
      if (!validation.isValid) {
        alert(validation.message);
        return;
      }
      
      ImageTransitions.updateCustomImage(transformations);
    });

    // Handle Enter key in textarea with validation
    transformationInput.on('keydown', function(event) {
      if (event.key === 'Enter' && event.ctrlKey) {
        const transformations = transformationInput.property('value');
        const validation = CloudinaryEngine.validateTransformations(transformations);
        
        if (!validation.isValid) {
          alert(validation.message);
          return;
        }
        
        ImageTransitions.updateCustomImage(transformations);
      }
    });

    // Handle example button clicks
    exampleButtons.on('click', function() {
      const transform = d3.select(this).attr('data-transform');
      transformationInput.property('value', transform);
      ImageTransitions.updateCustomImage(transform);
    });

    // Initialize with default transformation
    const defaultTransform = '';
    transformationInput.property('value', defaultTransform);
    ImageTransitions.updateCustomImage(defaultTransform);
  }
};

// ============================================================================
// QUIZ SYSTEM
// ============================================================================

const QuizSystem = {
  elements: {},
  
  init: () => {
    QuizSystem.elements = {
      submitBtn: DOMUtils.select('#submit-quiz'),
      results: DOMUtils.select('#quiz-results'),
      score: DOMUtils.select('#quiz-score'),
      message: DOMUtils.select('#quiz-message'),
      swagReward: DOMUtils.select('#swag-reward'),
      retakeBtn: DOMUtils.select('#retake-quiz')
    };
    
    QuizSystem.setupEventListeners();
    QuizSystem.checkVisibility();
  },

  setupEventListeners: () => {
    QuizSystem.elements.submitBtn.addEventListener('click', QuizSystem.handleSubmit);
    QuizSystem.elements.retakeBtn.addEventListener('click', QuizSystem.handleRetake);
    
    // Add visual feedback for selected answers
    document.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.addEventListener('change', QuizSystem.handleAnswerSelection);
    });
  },

  handleSubmit: () => {
    let score = 0;
    const { TOTAL_QUESTIONS, CORRECT_ANSWERS } = CONFIG.QUIZ;
    
    // Reset visual feedback
    QuizSystem.resetVisualFeedback();
    
    // Check answers
    for (let i = 1; i <= TOTAL_QUESTIONS; i++) {
      const selectedAnswer = document.querySelector(`input[name="q${i}"]:checked`);
      const questionDiv = document.querySelector(`[data-question="${i}"]`);
      
      if (selectedAnswer) {
        const isCorrect = selectedAnswer.value === CORRECT_ANSWERS[`q${i}`];
        const selectedLabel = selectedAnswer.closest('label');
        
        if (isCorrect) {
          score++;
        } else {
          selectedLabel.classList.remove('bg-gray-700/50');
          selectedLabel.classList.add('bg-red-600/30', 'border-red-500');
          questionDiv.classList.add('border-red-500');
        }
      } else {
        questionDiv.classList.add('border-red-500');
      }
    }

    // Display results
    const percentage = (score / TOTAL_QUESTIONS) * 100;
    QuizSystem.elements.score.textContent = `Score: ${score}/${TOTAL_QUESTIONS} (${percentage}%)`;
    
    QuizSystem.showResults(score);
    QuizSystem.displayResults();
    QuizSystem.scrollToResults();
  },

  resetVisualFeedback: () => {
    document.querySelectorAll('.quiz-question').forEach(question => {
      question.classList.remove('border-red-500', 'border-green-500');
      question.querySelectorAll('label').forEach(label => {
        label.classList.remove('bg-red-600/30', 'border-red-500', 'bg-green-600/30', 'border-green-500');
        label.classList.add('bg-gray-700/50');
      });
    });
  },

  showResults: (score) => {
    const { PASSING_SCORE, TOTAL_QUESTIONS } = CONFIG.QUIZ;
    const pct = Math.round((score / TOTAL_QUESTIONS) * 100);
    
    if (score >= PASSING_SCORE) {
      QuizSystem.elements.swagReward.classList.remove('hidden');
      QuizSystem.hideRetryButton();
      QuizSystem.elements.message.className = "text-lg mb-6 text-green-400 font-semibold";
      if (score === TOTAL_QUESTIONS) {
        QuizSystem.elements.message.textContent =
          "🎉 100%! You're a Cloudinary expert! Show this screen to claim your swag.";
      } else {
        QuizSystem.elements.message.textContent =
          `👍 You scored ${pct}% — Just enough to earn some swag. Show this screen to claim yours!`;
      }
    } else {
      QuizSystem.elements.swagReward.classList.add('hidden');
      QuizSystem.elements.message.textContent = "📚 Keep learning! Review the transformations above and try again!";
      QuizSystem.elements.message.className = "text-lg mb-6 text-red-400 font-semibold";
      QuizSystem.showRetryButton();
    }
  },

  displayResults: () => {
    QuizSystem.elements.results.classList.remove('hidden');
  },

  scrollToResults: () => {
    QuizSystem.elements.results.scrollIntoView({ behavior: 'smooth' });
  },

  showRetryButton: () => {
    if (QuizSystem.elements.retakeBtn) {
      QuizSystem.elements.retakeBtn.textContent = '🔄 Take Quiz Again';
      QuizSystem.elements.retakeBtn.className = 'mx-auto px-8 py-4 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white font-bold rounded-lg transition-all duration-300 transform hover:scale-105';
      QuizSystem.elements.retakeBtn.classList.remove('hidden');
      QuizSystem.elements.retakeBtn.style.display = 'block';
    }
  },

  hideRetryButton: () => {
    if (QuizSystem.elements.retakeBtn) {
      QuizSystem.elements.retakeBtn.style.display = 'none';
      QuizSystem.elements.retakeBtn.classList.add('hidden');
    }
  },

  handleRetake: () => {
    // Reset radio buttons
    document.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.checked = false;
    });
    
    // Reset visual feedback
    QuizSystem.resetVisualFeedback();
    
    // Hide results
    QuizSystem.elements.results.classList.add('hidden');
    QuizSystem.elements.swagReward.classList.add('hidden');
    
    // Hide buttons
    QuizSystem.hideRetryButton();
    
    // Scroll to top of quiz
    document.getElementById('quiz-container').scrollIntoView({ behavior: 'smooth' });
  },

  handleAnswerSelection: function() {
    if (QuizSystem.elements.results.classList.contains('hidden')) {
      const questionDiv = this.closest('.quiz-question');
      questionDiv.querySelectorAll('label').forEach(label => {
        label.classList.remove('bg-green-600/30', 'border-green-500');
        label.classList.add('bg-gray-700/50');
      });
      
      if (this.checked) {
        const selectedLabel = this.closest('label');
        selectedLabel.classList.remove('bg-gray-700/50');
        selectedLabel.classList.add('bg-green-600/30', 'border-green-500');
      }
    }
  },

  updateQuizSectionVisibility: () => {
    const showQuiz = URLUtils.hasParameter('quiz', 'true');
    const quizSection = DOMUtils.select('#quiz-section');
    
    if (quizSection) {
      if (showQuiz) {
        quizSection.classList.remove('hidden');
        quizSection.style.display = 'block';
        quizSection.style.visibility = 'visible';
        quizSection.style.opacity = '1';
      } else {
        quizSection.classList.add('hidden');
        quizSection.style.display = 'none';
      }
    }
  },

  checkVisibility: () => {
    QuizSystem.updateQuizSectionVisibility();
  }
};

// ============================================================================
// SITE NAVIGATION (quiz / challenge deep links)
// ============================================================================

const SiteNavigation = {
  scrollToId: (id, behavior = 'smooth') => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior, block: 'start' });
    }
  },

  applyDeepLinksFromUrl: () => {
    QuizSystem.updateQuizSectionVisibility();
    ChallengeLab.updatePrizeLabVisibility();
    ChallengeLab.syncEventDisplay();
    requestAnimationFrame(() => {
      if (URLUtils.hasParameter('quiz', 'true')) {
        SiteNavigation.scrollToId('quiz-section');
      } else if (URLUtils.hasParameter('challenge', 'true')) {
        SiteNavigation.scrollToId('prize-lab');
      }
    });
  },

  goToQuiz: (e) => {
    if (e) e.preventDefault();
    URLUtils.setSearchParams({ quiz: 'true', challenge: null, event: null });
    QuizSystem.updateQuizSectionVisibility();
    ChallengeLab.updatePrizeLabVisibility();
    SiteNavigation.scrollToId('quiz-section');
  },

  goToChallenge: (e) => {
    if (e) e.preventDefault();
    const raw = e?.currentTarget?.dataset?.event;
    const ev =
      raw !== undefined && String(raw).trim() !== ''
        ? String(raw).trim()
        : CONFIG.PRIZE_CHALLENGE.DEFAULT_EVENT;
    URLUtils.setSearchParams({ challenge: 'true', quiz: null, event: ev });
    QuizSystem.updateQuizSectionVisibility();
    ChallengeLab.updatePrizeLabVisibility();
    ChallengeLab.syncEventDisplay();
    SiteNavigation.scrollToId('prize-lab');
  },

  init: () => {
    document.querySelectorAll('[data-nav-action="quiz"]').forEach((el) => {
      el.addEventListener('click', SiteNavigation.goToQuiz);
    });
    document.querySelectorAll('[data-nav-action="challenge"]').forEach((el) => {
      el.addEventListener('click', SiteNavigation.goToChallenge);
    });
    window.addEventListener('popstate', () => {
      SiteNavigation.applyDeepLinksFromUrl();
    });
    SiteNavigation.applyDeepLinksFromUrl();
  }
};

// ============================================================================
// ERROR HANDLING
// ============================================================================

const ErrorHandler = {
  init: () => {
    // Add specific handler for null reference errors in promises
    window.addEventListener('error', function(event) {
      if (event.error && event.error.message && event.error.message.includes('null')) {
        console.warn('Null reference error caught:', event.error.message);
      }
    });
  }
};

// ============================================================================
// MAIN APPLICATION INITIALIZATION
// ============================================================================

const App = {
  init: () => {
    // Initialize error handling
    ErrorHandler.init();
    
    // Initialize starfield
    Starfield.init();
    
    // Generate sections and initialize images
    SectionsGenerator.generateAll();
    SectionsGenerator.initializeImages();
    URLBreakdown.initializeAll();
    
    // Set up intersection observer
    IntersectionObserver.init();
    
    // Initialize interactive transformations
    InteractiveTransformations.init();
    
    // Initialize quiz system
    QuizSystem.init();
    
    // Prize challenge lab (tasks, validation, submit)
    ChallengeLab.init();
    
    // Deep links + header/footer nav (quiz & challenge)
    SiteNavigation.init();
  }
};

// ============================================================================
// DOM READY EVENT LISTENERS
// ============================================================================

// Main app initialization
document.addEventListener('DOMContentLoaded', App.init); 