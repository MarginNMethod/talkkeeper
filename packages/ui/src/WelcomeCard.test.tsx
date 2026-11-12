import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { WelcomeCard } from './index';

test('renders its heading and content', () => {
  render(<WelcomeCard title="A quiet workspace">Your notes belong here.</WelcomeCard>);
  expect(screen.getByRole('heading').textContent).toBe('A quiet workspace');
  expect(screen.getByText('Your notes belong here.')).toBeTruthy();
});
