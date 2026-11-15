import React from 'react';
import { createRoot } from 'react-dom/client';
import { Popover } from '@talkkeeper/ui';
const host = document.createElement('div');
document.body.append(host);
createRoot(host).render(<Popover label="Primitive options"><button>Rename item</button></Popover>);
