import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { App } from './App';

test('shows the workspace and consent reminder', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'TalkKeeper' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Recording consent' })).toBeTruthy();
});
