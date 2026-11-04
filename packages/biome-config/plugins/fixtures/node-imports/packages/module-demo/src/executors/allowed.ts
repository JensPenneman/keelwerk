import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';
import { fetch as get } from 'undici';

export const used = [readFileSync, nodemailer, get];
