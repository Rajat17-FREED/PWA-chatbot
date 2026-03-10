import * as fs from 'fs';
import * as path from 'path';
import { User, UsersData, IdentifyResponse, Segment } from '../types';
import { conversationStarters } from '../prompts/segments';
import { lookupByPhone as phoneFind, looksLikePhone } from './phoneLookup';

let usersData: UsersData | null = null;

function loadData(): UsersData {
  if (usersData) return usersData;

  const dataPath = path.join(__dirname, '..', 'data', 'users.json');
  const raw = fs.readFileSync(dataPath, 'utf-8');
  usersData = JSON.parse(raw) as UsersData;
  console.log(`Loaded ${usersData.users.length} users with ${Object.keys(usersData.nameIndex).length} name index entries`);
  return usersData;
}

function foundResponse(user: User): IdentifyResponse {
  return {
    status: 'found',
    user,
    starters: conversationStarters[user.segment] || [],
    message: `Found your profile, ${user.firstName}!`,
  };
}

export function getUserByLeadRefId(leadRefId: string): User | undefined {
  const data = loadData();
  return data.users.find(u => u.leadRefId === leadRefId);
}

/**
 * Attempt to find a user by phone number (dedupeId from lead-complete.csv).
 */
export function lookupByPhoneNumber(phone: string): IdentifyResponse {
  const leadRefId = phoneFind(phone);
  if (!leadRefId) {
    return {
      status: 'not_found',
      message: "I couldn't find an account with that phone number. Could you try entering your registered name instead?",
    };
  }

  const user = getUserByLeadRefId(leadRefId);
  if (!user) {
    return {
      status: 'not_found',
      message: "I found your record but couldn't load your profile. Please try your name instead.",
    };
  }

  return foundResponse(user);
}

export function lookupByName(name: string): IdentifyResponse {
  const data = loadData();
  const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ');

  if (!normalized) {
    return { status: 'not_found', message: 'Please provide your name or registered phone number so I can look up your profile.' };
  }

  // If input looks like a phone number, route to phone lookup
  if (looksLikePhone(normalized.replace(/\s/g, ''))) {
    return lookupByPhoneNumber(normalized.replace(/\s/g, ''));
  }

  // Strategy 1: Exact match in name index
  const exactMatch = data.nameIndex[normalized];
  if (exactMatch && exactMatch.length === 1) {
    const user = data.users.find(u => u.leadRefId === exactMatch[0]);
    if (user) return foundResponse(user);
  }

  if (exactMatch && exactMatch.length > 1) {
    const candidates = exactMatch
      .map(id => data.users.find(u => u.leadRefId === id))
      .filter((u): u is User => !!u)
      .map(u => ({ leadRefId: u.leadRefId, firstName: u.firstName, lastName: u.lastName, segment: u.segment }));

    return {
      status: 'multiple',
      candidates,
      message: 'I found a few accounts with that name. Could you help me identify which one is you?',
    };
  }

  // Strategy 2: Substring search across all user names
  const matches: User[] = [];
  for (const user of data.users) {
    const fullName = `${user.firstName} ${user.lastName}`.toLowerCase();
    if (fullName.includes(normalized) || normalized.includes(fullName)) {
      matches.push(user);
    }
  }

  if (matches.length === 1) return foundResponse(matches[0]);

  if (matches.length > 1) {
    return {
      status: 'multiple',
      candidates: matches.map(u => ({ leadRefId: u.leadRefId, firstName: u.firstName, lastName: u.lastName, segment: u.segment })),
      message: 'I found a few accounts with that name. Could you help me identify which one is you?',
    };
  }

  // Strategy 3: Partial first name match
  const partialMatches: User[] = [];
  for (const user of data.users) {
    if (user.firstName.toLowerCase().includes(normalized) || normalized.includes(user.firstName.toLowerCase())) {
      partialMatches.push(user);
    }
  }

  if (partialMatches.length === 1) return foundResponse(partialMatches[0]);

  if (partialMatches.length > 1 && partialMatches.length <= 5) {
    return {
      status: 'multiple',
      candidates: partialMatches.map(u => ({ leadRefId: u.leadRefId, firstName: u.firstName, lastName: u.lastName, segment: u.segment })),
      message: 'I found a few accounts with similar names. Could you help me identify which one is you?',
    };
  }

  return {
    status: 'not_found',
    message: "I couldn't find an account with that name or number. Try your full registered name, or your 10-digit mobile number. You can still ask me general questions about FREED!",
  };
}

export function getStartersForSegment(segment: Segment) {
  return conversationStarters[segment] || [];
}

export function getAllLeadRefIds(): Set<string> {
  const data = loadData();
  return new Set(data.users.map(u => u.leadRefId));
}
