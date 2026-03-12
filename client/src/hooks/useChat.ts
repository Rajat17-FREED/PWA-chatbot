import { useReducer, useCallback, useEffect, useRef } from 'react';
import type { ChatState, Message, ConversationStarter, User } from '../types';
import * as api from '../services/api';
import { useAuth } from '../context/AuthContext';

type Action =
  | { type: 'ADD_MESSAGE'; message: Message }
  | { type: 'SET_LOADING'; isLoading: boolean }
  | { type: 'SET_PHASE'; phase: ChatState['phase'] }
  | { type: 'SET_USER'; user: User; starters: ConversationStarter[] }
  | { type: 'SET_CANDIDATES'; candidates: ChatState['candidates'] }
  | { type: 'CLEAR_STARTERS' }
  | { type: 'RESET'; messages: Message[]; user: User | null; starters: ConversationStarter[]; phase: ChatState['phase'] };

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function createMessage(role: 'user' | 'assistant', content: string, extra?: Partial<Message>): Message {
  return {
    id: generateId(),
    role,
    content,
    timestamp: new Date(),
    ...extra,
  };
}

const defaultGreeting = createMessage(
  'assistant',
  "Hi there! Welcome to **FREED**. I'm here to help with your financial queries. Please enter your **name** or **10-digit mobile number** to pull up your profile and get personalised help!"
);

const initialState: ChatState = {
  phase: 'greeting',
  user: null,
  messages: [defaultGreeting],
  isLoading: false,
  candidates: [],
  starters: [],
};

function reducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.message] };
    case 'SET_LOADING':
      return { ...state, isLoading: action.isLoading };
    case 'SET_PHASE':
      return { ...state, phase: action.phase };
    case 'SET_USER':
      return { ...state, user: action.user, starters: action.starters, phase: 'starters' };
    case 'SET_CANDIDATES':
      return { ...state, candidates: action.candidates, phase: 'disambiguating' };
    case 'CLEAR_STARTERS':
      return { ...state, starters: [], phase: 'chatting' };
    case 'RESET':
      return {
        ...state,
        messages: action.messages,
        user: action.user,
        starters: action.starters,
        phase: action.phase,
        isLoading: false,
        candidates: [],
      };
    default:
      return state;
  }
}

export function useChat() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const auth = useAuth();
  const hasInitRef = useRef(false);
  // Tracks the intent of the first starter chip clicked — persists for entire conversation
  const activeIntentRef = useRef<string | undefined>(undefined);

  // When auth changes (user logs in via login modal), pre-populate chat
  useEffect(() => {
    if (auth.isLoggedIn && auth.user && !hasInitRef.current) {
      hasInitRef.current = true;
      dispatch({
        type: 'RESET',
        messages: [
          createMessage(
            'assistant',
            `Welcome, ${auth.user.firstName}! I've loaded your profile. Here are some things I can help you with:`
          ),
        ],
        user: auth.user,
        starters: auth.starters,
        phase: 'starters',
      });
    } else if (!auth.isLoggedIn && hasInitRef.current) {
      hasInitRef.current = false;
      activeIntentRef.current = undefined;
      dispatch({
        type: 'RESET',
        messages: [defaultGreeting],
        user: null,
        starters: [],
        phase: 'greeting',
      });
    }
  }, [auth.isLoggedIn, auth.user, auth.starters]);

  const identifyUser = useCallback(async (name: string) => {
    dispatch({ type: 'ADD_MESSAGE', message: createMessage('user', name) });
    dispatch({ type: 'SET_LOADING', isLoading: true });
    dispatch({ type: 'SET_PHASE', phase: 'identifying' });

    try {
      const result = await api.identifyUser(name);

      if (result.status === 'found' && result.user) {
        dispatch({
          type: 'SET_USER',
          user: result.user,
          starters: result.starters || [],
        });
        dispatch({
          type: 'ADD_MESSAGE',
          message: createMessage(
            'assistant',
            `Great to meet you, ${result.user.firstName}! I've pulled up your profile. Here are some things I can help you with — feel free to pick one or ask me anything!`
          ),
        });
      } else if (result.status === 'multiple' && result.candidates) {
        dispatch({ type: 'SET_CANDIDATES', candidates: result.candidates });
        dispatch({
          type: 'ADD_MESSAGE',
          message: createMessage('assistant', result.message),
        });
      } else {
        dispatch({ type: 'SET_PHASE', phase: 'chatting' });
        dispatch({
          type: 'ADD_MESSAGE',
          message: createMessage('assistant', result.message),
        });
      }
    } catch {
      dispatch({ type: 'SET_PHASE', phase: 'greeting' });
      dispatch({
        type: 'ADD_MESSAGE',
        message: createMessage(
          'assistant',
          "I'm having trouble looking that up right now. Could you try again?"
        ),
      });
    } finally {
      dispatch({ type: 'SET_LOADING', isLoading: false });
    }
  }, []);

  const handleSelectUser = useCallback(async (leadRefId: string) => {
    dispatch({ type: 'SET_LOADING', isLoading: true });

    try {
      const result = await api.selectUser(leadRefId);
      if (result.status === 'found' && result.user) {
        dispatch({
          type: 'SET_USER',
          user: result.user,
          starters: result.starters || [],
        });
        dispatch({
          type: 'ADD_MESSAGE',
          message: createMessage(
            'assistant',
            `Welcome, ${result.user.firstName}! I've loaded your profile. Here are some things I can help you with:`
          ),
        });
      }
    } catch {
      dispatch({
        type: 'ADD_MESSAGE',
        message: createMessage(
          'assistant',
          "I'm having trouble loading that profile. Could you try again?"
        ),
      });
    } finally {
      dispatch({ type: 'SET_LOADING', isLoading: false });
    }
  }, []);

  const sendMessage = useCallback(async (text: string, intentTag?: string) => {
    // If a starter chip was clicked (has intentTag), lock it in for the whole conversation
    if (intentTag) activeIntentRef.current = intentTag;

    dispatch({ type: 'CLEAR_STARTERS' });
    dispatch({ type: 'ADD_MESSAGE', message: createMessage('user', text) });
    dispatch({ type: 'SET_LOADING', isLoading: true });

    try {
      const leadRefId = state.user?.leadRefId || '';
      // Count only user messages for messageCount (assistant messages don't count)
      const userMessageCount = state.messages.filter(m => m.role === 'user').length;
      const result = await api.sendChatMessage(text, leadRefId, state.messages, userMessageCount, activeIntentRef.current);

      dispatch({
        type: 'ADD_MESSAGE',
        message: createMessage('assistant', result.reply, {
          redirectUrl: result.redirectUrl,
          redirectLabel: result.redirectLabel,
          followUps: result.followUps,
          tooltips: result.tooltips,
        }),
      });
    } catch {
      dispatch({
        type: 'ADD_MESSAGE',
        message: createMessage(
          'assistant',
          "I'm having trouble connecting right now. Could you try again in a moment?"
        ),
      });
    } finally {
      dispatch({ type: 'SET_LOADING', isLoading: false });
    }
  }, [state.user, state.messages]);

  const handleInput = useCallback(
    (text: string) => {
      if (state.phase === 'greeting' || state.phase === 'identifying') {
        identifyUser(text);
      } else {
        sendMessage(text);
      }
    },
    [state.phase, identifyUser, sendMessage]
  );

  const clearConversation = useCallback(() => {
    activeIntentRef.current = undefined; // reset intent when conversation clears
    if (state.user) {
      // If logged in, keep user but restart conversation with starters
      dispatch({
        type: 'RESET',
        messages: [
          createMessage(
            'assistant',
            `Alright ${state.user.firstName}, let's start fresh! How can I help you today?`
          ),
        ],
        user: state.user,
        starters: auth.starters || [],
        phase: 'starters',
      });
    } else {
      // Not logged in, full reset
      dispatch({
        type: 'RESET',
        messages: [defaultGreeting],
        user: null,
        starters: [],
        phase: 'greeting',
      });
    }
  }, [state.user, auth.starters]);

  return {
    state,
    handleInput,
    handleSelectUser,
    sendMessage,
    clearConversation,
  };
}
