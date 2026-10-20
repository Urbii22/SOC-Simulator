import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

afterEach(() => { try { localStorage.clear(); } catch { /* Node-environment suites have no storage. */ } });
