import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Button, Card, Row, Pill, Popover, IconButton, EmptyState } from './index';
afterEach(cleanup);
test('buttons expose native actions, variants, sizes and disabled behavior', () => {
  const click = vi.fn();
  const { rerender } = render(<Button variant="danger" size="sm" onClick={click}>Delete</Button>);
  const button = screen.getByRole('button', { name: 'Delete' });
  fireEvent.click(button);
  expect(click).toHaveBeenCalledTimes(1);
  expect(button.className).toContain('tk-button--danger');
  expect(button.className).toContain('tk-button--sm');
  expect(button.getAttribute('type')).toBe('button');
  rerender(<Button disabled onClick={click}>Delete</Button>);
  fireEvent.click(button);
  expect(click).toHaveBeenCalledTimes(1);
});
test('icon button requires and exposes an accessible name', () => {
  render(<IconButton aria-label="More options"><svg aria-hidden="true" /></IconButton>);
  expect(screen.getByRole('button', { name: 'More options' })).toBeTruthy();
});
test('card passes accessible semantics and content through', () => {
  render(<Card role="region" aria-label="Coming up">No meetings</Card>);
  expect(screen.getByRole('region', { name: 'Coming up' }).textContent).toBe('No meetings');
});
test('row exposes all slots without nesting interactive controls', () => {
  render(<Row icon={<span>TK</span>} title={<a href="#note">Planning</a>} subtitle="Yesterday" trailing="12 min" actions={<IconButton aria-label="Archive">A</IconButton>} />);
  expect(screen.getByRole('link', { name: 'Planning' })).toBeTruthy();
  for (const text of ['TK', 'Yesterday', '12 min']) expect(screen.getByText(text)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Archive' }).closest('a')).toBeNull();
});
test('pill conveys text without implying an action', () => {
  render(<Pill>Local</Pill>);
  expect(screen.getByText('Local').tagName).toBe('SPAN');
});
test('empty state has a heading, explanation and action', () => {
  render(<EmptyState title="No notes yet" action={<Button>Create note</Button>}>Begin a conversation.</EmptyState>);
  expect(screen.getByRole('heading', { name: 'No notes yet' })).toBeTruthy();
  expect(screen.getByText('Begin a conversation.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Create note' })).toBeTruthy();
});
test('popover focuses content, Escape dismisses and restores focus', () => {
  render(<Popover label="Options"><Button>Rename</Button></Popover>);
  const trigger = screen.getByRole('button', { name: 'Options' });
  trigger.focus();
  fireEvent.click(trigger); // Native button activation is shared by Enter and Space.
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('dialog', { name: 'Options' })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Rename' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});
test('popover focuses an empty panel and dismisses outside', () => {
  render(<Popover label="Details">Nothing else</Popover>);
  fireEvent.click(screen.getByRole('button'));
  expect(document.activeElement).toBe(screen.getByRole('dialog'));
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button'));
});
