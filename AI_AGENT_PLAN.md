# DoGoods AI Agent — Implementation Plan

**Created**: March 30, 2026
**Goal**: Build "Nourish" — a comprehensive AI assistant that helps users do everything in the app through conversation and voice, especially for users who aren't tech-savvy.

---

## Current State Assessment

### ✅ Already Built

| Item                 | Status              | Notes                                                                                                                              |
| -------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| AI database tables   | ✅ Complete         | `ai_conversations`, `ai_reminders`, `ai_feedback` with RLS                                                                         |
| Training data        | ✅ Complete         | 5000+ lines in `supabase/functions/ai-chat/ai_training_data.json`                                                                  |
| AIAssistant.jsx      | ✅ Built (disabled) | 450+ line chat modal — will be replaced by new AIChatPanel                                                                         |
| DeepSeek integration | ✅ Built            | `deepseekChat.js`, `deepseekClient.js` with circuit breaker + rate limiter                                                         |
| AI business logic    | ✅ Built            | `aiAgent.js` with rate limiting (50 req/min), circuit breaker (5 failures)                                                         |
| MatchingEngine       | ✅ Built            | 8-dimension food matching (location, urgency, value, trust, etc.)                                                                  |
| 5 AI functions       | ✅ Built            | `chatWithNourish`, `getRecipeSuggestions`, `getStorageTips`, `getFoodPairings`, `calculateEnvironmentalImpact` (in useSupabase.js) |
| SMS system           | ✅ Built            | Twilio via `send-sms` Edge Function                                                                                                |
| User chat widget     | ✅ Built            | User-to-admin messaging with real-time                                                                                             |
| Location service     | ✅ Built            | GPS, distance calculation, radius filtering                                                                                        |

### ❌ Must Build

| Item                                                                         | Priority | Week |
| ---------------------------------------------------------------------------- | -------- | ---- |
| `supabase/functions/ai-chat/index.ts` — Edge Function handler                | Critical | 1    |
| `utils/services/aiChatService.js` — Client service for AI conversations      | Critical | 1    |
| `utils/hooks/useAIChat.js` — React hook for chat state + voice               | Critical | 1    |
| `components/assistant/AIChatPanel.jsx` — New chat UI                         | Critical | 1    |
| `components/assistant/VoiceInput.jsx` — Mic input (Web Speech API)           | Critical | 1    |
| `components/assistant/VoiceOutput.jsx` — TTS output (SpeechSynthesis)        | Critical | 1    |
| AI methods in `dataService.js` — CRUD for AI tables                          | Critical | 1    |
| AI tool implementations in Edge Function (search food, create listing, etc.) | High     | 2    |
| `supabase/functions/ai-reminders/index.ts` — Cron job for reminders          | High     | 2    |
| Spanish end-to-end support                                                   | High     | 2    |
| `pages/admin/AILogs.jsx` — Admin monitoring dashboard                        | Medium   | 3    |
| Proactive notification system                                                | Medium   | 3    |
| Role-specific AI behaviors (recipient/donor/admin)                           | Medium   | 3    |
| Polish, feedback system, accessibility                                       | Lower    | 4    |

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                     USER'S BROWSER                       │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ AIChatPanel  │  │  VoiceInput  │  │  VoiceOutput   │  │
│  │ (chat UI)    │  │  (mic→text)  │  │  (text→speech) │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬────────┘  │
│         │                 │                   │           │
│         ▼                 ▼                   ▲           │
│  ┌──────────────────────────────────────────────────┐    │
│  │          useAIChat Hook                           │    │
│  │  messages[], sendMessage(), isLoading,            │    │
│  │  startVoice(), stopVoice(), language              │    │
│  └──────────────────────┬───────────────────────────┘    │
│                         │                                 │
│  ┌──────────────────────▼───────────────────────────┐    │
│  │          aiChatService                            │    │
│  │  send(), getHistory(), clearHistory(),            │    │
│  │  saveFeedback()                                   │    │
│  └──────────────────────┬───────────────────────────┘    │
└─────────────────────────┼────────────────────────────────┘
                          │ HTTPS
                          ▼
┌──────────────────────────────────────────────────────────┐
│                 SUPABASE EDGE FUNCTION                    │
│                 /functions/v1/ai-chat                     │
│                                                          │
│  1. Authenticate user (JWT from Supabase Auth)           │
│  2. Load user profile + context from DB                  │
│  3. Load conversation history (last 20 messages)         │
│  4. Inject system prompt + training data                 │
│  5. Call DeepSeek with function-calling tools             │
│  6. Execute tool calls (query DB, create listings, etc.) │
│  7. Save conversation to ai_conversations table          │
│  8. Return response + tool results                       │
└──────────────────────────┬───────────────────────────────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
        ┌──────────┐ ┌────────┐ ┌─────────┐
        │ DeepSeek │ │Supabase│ │ Twilio  │
        │   API    │ │   DB   │ │  SMS    │
        └──────────┘ └────────┘ └─────────┘
```

---

## AI Tool Capabilities (Function Calling)

The AI agent will have these tools available to act on behalf of users:

### For Everyone

| Tool                      | Action                                              | DB Tables             |
| ------------------------- | --------------------------------------------------- | --------------------- |
| `search_food_nearby`      | Find available food by location + dietary filters   | `food_listings`       |
| `get_directions`          | Walking/driving time to a food location             | Mapbox API            |
| `get_distribution_events` | Upcoming community food events                      | `distribution_events` |
| `get_recipes`             | Generate recipes from claimed/available items       | DeepSeek              |
| `get_storage_tips`        | Food preservation advice                            | DeepSeek              |
| `create_reminder`         | Set pickup/event/custom reminders                   | `ai_reminders`        |
| `get_platform_help`       | Navigate users to features, explain how things work | Training data         |

### For Recipients (Finding Food)

| Tool                         | Action                                      | DB Tables                 |
| ---------------------------- | ------------------------------------------- | ------------------------- |
| `claim_food`                 | Claim a food listing on behalf of user      | `food_claims`             |
| `get_my_claims`              | Check claim history and active claims       | `food_claims`             |
| `get_pickup_status`          | Upcoming pickups, deadlines, receipt status | `receipts`, `food_claims` |
| `update_dietary_preferences` | Set dietary restrictions in profile         | `users`                   |

### For Donors (Sharing Food)

| Tool                  | Action                              | DB Tables            |
| --------------------- | ----------------------------------- | -------------------- |
| `create_food_listing` | Draft and post a food listing       | `food_listings`      |
| `get_my_listings`     | Check listing status, views, claims | `food_listings`      |
| `update_listing`      | Edit or close a listing             | `food_listings`      |
| `schedule_donation`   | Set up recurring donations          | `donation_schedules` |

### For Admins

| Tool                        | Action                                  | DB Tables                         |
| --------------------------- | --------------------------------------- | --------------------------------- |
| `get_platform_stats`        | Claims, listings, users this week/month | Multiple                          |
| `get_pending_verifications` | Items awaiting verification             | `verification_logs`               |
| `get_flagged_content`       | Content moderation queue                | `community_posts`                 |
| `get_ai_usage_stats`        | AI conversation metrics                 | `ai_conversations`, `ai_feedback` |

---

## Week-by-Week Implementation

---

### WEEK 1 — Core Engine + Chat UI ($300)

**Objective**: Working AI chat on every page. Text + voice input/output. Conversation history saved.

#### Task 1.1: AI Data Methods in dataService.js

Add 6 methods to `utils/dataService.js`:

```
getAIConversations(userId, limit)    → SELECT from ai_conversations
saveAIMessage(userId, role, message, metadata)  → INSERT into ai_conversations
deleteAIConversations(userId)        → DELETE from ai_conversations
getAIReminders(userId)               → SELECT from ai_reminders
createAIReminder(userId, message, triggerTime, type, relatedId)  → INSERT
saveAIFeedback(conversationId, userId, rating, comment)  → INSERT into ai_feedback
```

#### Task 1.2: Edge Function — ai-chat/index.ts

Create `supabase/functions/ai-chat/index.ts`:

- **Auth**: Verify Supabase JWT, extract user_id
- **Context loading**: Query user profile (name, dietary restrictions, location, is_admin)
- **History**: Load last 20 messages from `ai_conversations`
- **System prompt**: Inject training data + user context + role info
- **DeepSeek call**: Use function-calling format with tool definitions
- **Tool execution**: Handle tool calls by querying Supabase DB
- **Persistence**: Save user message + assistant response to `ai_conversations`
- **Response**: Return `{ response, toolResults, suggestedActions }`
- **Anonymous mode**: If no JWT, respond with general info only (no personal data access)

#### Task 1.3: Client Service — aiChatService.js

Create `utils/services/aiChatService.js`:

```javascript
class AIChatService {
  async sendMessage(message, context)     // Call Edge Function, save to DB
  async getHistory(userId, limit = 50)    // Load conversation history
  async clearHistory(userId)              // Delete all conversations
  async submitFeedback(msgId, rating)     // Thumbs up/down
  async getReminders(userId)             // Active reminders
}
```

#### Task 1.4: React Hook — useAIChat.js

Create `utils/hooks/useAIChat.js`:

```javascript
export function useAIChat() {
  return {
    messages, // Conversation array
    sendMessage, // Send text message
    isLoading, // AI is thinking
    isListening, // Mic is active
    startVoice, // Begin speech recognition
    stopVoice, // Stop listening
    clearHistory, // Wipe conversation
    language, // Detected language (en/es)
    setLanguage, // Force language
    error, // Last error
  };
}
```

#### Task 1.5: AIChatPanel.jsx — New Chat UI

Create `components/assistant/AIChatPanel.jsx`:

- **Floating bubble**: Bottom-right, positioned above UserChatWidget
- **Expandable panel**: Slides up to show conversation thread
- **Full-screen mode**: On mobile, takes over the screen
- **Message bubbles**: User (right, blue) vs Nourish (left, green)
- **Typing indicator**: Animated dots while AI responds
- **Quick actions**: Suggested prompts ("Find food near me", "My pickups", "Share food")
- **Tool result cards**: Rich cards for food listings, directions, recipes
- **Feedback**: Thumbs up/down on each AI message
- **Minimize/close**: Toggle between bubble, panel, and hidden
- **Branding**: Nourish avatar, warm green theme

#### Task 1.6: VoiceInput.jsx — Microphone Component

Create `components/assistant/VoiceInput.jsx`:

- **Web Speech API**: `SpeechRecognition` for mic→text
- **Push-to-talk**: Hold button or tap toggle
- **Language detection**: English (en-US) / Spanish (es-ES)
- **Visual feedback**: Recording indicator, waveform animation
- **Fallback**: Hide mic button if browser doesn't support Speech API
- **Transcript**: Sends recognized text to chat as a message

#### Task 1.7: VoiceOutput.jsx — Text-to-Speech Component

Create `components/assistant/VoiceOutput.jsx`:

- **SpeechSynthesis API**: Browser-native TTS
- **Auto-read**: Optionally reads AI responses aloud
- **Language switching**: English/Spanish voice selection
- **Mute toggle**: Users can silence TTS
- **iOS workaround**: "Tap to hear" button (Safari auto-play restriction)

#### Task 1.8: Wire into MainLayout.jsx

- Add `<AIChatPanel />` to MainLayout (replaces commented-out AIAssistant)
- Position above existing UserChatWidget
- Visible on all pages (authenticated + anonymous)

#### Task 1.9: Unit Tests (5 tests)

- Message send/receive cycle
- Conversation history load
- Voice transcript → message
- Spanish language detection
- Error handling (API failure → friendly message)

#### Week 1 Deliverables Checklist

- [ ] 6 AI data methods in dataService.js
- [ ] ai-chat Edge Function responding with DeepSeek
- [ ] aiChatService.js client service
- [ ] useAIChat.js hook with voice support
- [ ] AIChatPanel.jsx visible on all pages
- [ ] VoiceInput.jsx microphone working
- [ ] VoiceOutput.jsx TTS working
- [ ] Conversation history persisted to DB
- [ ] 5 passing tests

---

### WEEK 2 — Platform Data Integration + Spanish ($300)

**Objective**: AI reads/writes live platform data. Full Spanish support. Anonymous mode.

#### Task 2.1: Food & Location Tools (in Edge Function)

Implement these tool handlers in `ai-chat/index.ts`:

- **`search_food_nearby`**: Query `food_listings` by lat/lon + radius + dietary filters, return formatted results with distances
- **`get_directions`**: Proxy Mapbox Directions API for route summaries
- **`get_distribution_events`**: Query upcoming events with capacity info
- **`get_recipes`**: Generate recipes from user's claimed items
- **`get_storage_tips`**: Preservation advice for specific foods

#### Task 2.2: User Data Tools

- **`get_my_claims`**: Read user's `food_claims` with status, listing details
- **`get_pickup_status`**: Read `receipts` + `food_claims` for upcoming pickups
- **`get_user_profile`**: Load full profile for personalization
- **`update_dietary_preferences`**: Write dietary restrictions to `users` table

#### Task 2.3: Donor Tools

- **`create_food_listing`**: Draft listing from natural language ("I have leftover bread") → structured `food_listings` INSERT
- **`get_my_listings`**: Read donor's listings with claim counts
- **`update_listing`**: Edit listing details or mark as claimed/expired

#### Task 2.4: Claim Tool

- **`claim_food`**: Create a `food_claims` record on user's behalf
- Requires confirmation step ("I found 'Fresh Vegetables' at 0.3 miles — shall I claim it for you?")
- Respects existing claim limits

#### Task 2.5: Reminder System

- Implement `create_reminder` tool in Edge Function
- Create `supabase/functions/ai-reminders/index.ts`:
  - Cron every 15 minutes
  - Query `ai_reminders WHERE trigger_time <= now() AND sent = false`
  - Send SMS via existing `send-sms` function
  - Create in-app notification in `notifications` table
  - Mark reminder as sent

#### Task 2.6: Spanish End-to-End

- DeepSeek system prompt: detect language, respond in same language
- VoiceInput: Set `SpeechRecognition.lang = 'es-ES'` when Spanish detected
- VoiceOutput: Select Spanish voice from `SpeechSynthesis.getVoices()`
- Quick actions: Show in detected language
- Test full flow: Spanish voice input → Spanish AI response → Spanish TTS

#### Task 2.7: Anonymous Mode

- No JWT → AI responds with general info only
- Available: food search (public listings), platform help, FAQs, distribution events
- Unavailable: personal data, claims, reminders, profile updates
- Prompt: "Sign in to unlock personalized features"

#### Task 2.8: Fallback Chain

- DeepSeek fails → circuit breaker → friendly error message + retry button
- Voice not supported → hide mic, text-only mode
- Location unavailable → ask for zip code / address
- Tool call fails → explain what went wrong, suggest manual action

#### Week 2 Deliverables Checklist

- [ ] `search_food_nearby` returns real listings with distances
- [ ] `get_directions` provides route info
- [ ] `get_distribution_events` shows upcoming events
- [ ] `claim_food` creates claims with confirmation
- [ ] `create_food_listing` posts listings from conversation
- [ ] `create_reminder` writes to DB
- [ ] ai-reminders cron sends SMS + notifications
- [ ] Spanish voice input → Spanish response → Spanish TTS
- [ ] Anonymous mode (limited but functional)
- [ ] All fallbacks gracefully handled

---

### WEEK 3 — Launch + Advanced Features ($300)

**Objective**: AI live for all users. Proactive notifications. Role-specific intelligence. Voice-location search.

#### Task 3.1: Proactive Notification System

- New Edge Function or extend `ai-reminders`:
  - Check for new nearby listings matching user preferences
  - Draft personalized "New food available" messages
  - Send via in-app notification + SMS (if opted in)
  - Admin toggle to enable/disable broadcast messages

#### Task 3.2: Role-Specific AI Behaviors

- **Recipients**: "Food ready for pickup" nudges, claim suggestions based on dietary profile, "New produce nearby" alerts
- **Donors**: "Your listing has 3 claims" updates, expiration warnings, impact stats ("Your food helped 5 people")
- **Admins**: Dashboard summaries ("12 pending verifications"), trend reports ("Claims up 20% this week")
- **Profile gap detection**: AI prompts users to fill missing dietary needs, location, phone for SMS

#### Task 3.3: Smart Suggestions & Natural Language Queries

- "Show me all vegan food within 2 miles" → parsed to structured query
- "What's expiring today?" → urgent food listings
- Contextual suggestions based on user history
- Quick action chips update based on user role and recent activity

#### Task 3.4: Recipe Generation

- AI creates recipes from user's claimed/available items
- Considers: household size, dietary restrictions, available cooking equipment
- Culturally appropriate suggestions
- Low-resource friendly (minimal ingredients)

#### Task 3.5: Voice-Location Food Search

- "What food is near me?" via mic → GPS lookup → ranked results by urgency + distance
- Rich result cards with claim buttons directly in chat

#### Task 3.6: Admin AI Logs Page

Create `pages/admin/AILogs.jsx`:

- Total conversations, messages per session
- Tool usage breakdown (which tools are used most)
- Feedback scores (helpful vs. not helpful ratio)
- Flagged conversations (low-rated responses)
- Error rate tracking
- Wire into `app.jsx` at `/admin/ai-logs`

#### Task 3.7: Full QA Testing

- Test all user roles (recipient, donor, admin) with real data
- Test English + Spanish flows end-to-end
- Test voice on Chrome, Safari, Firefox, mobile
- Test reminder delivery (SMS + in-app)
- Test anonymous vs authenticated
- Test edge cases: empty results, expired food, no location, slow network

#### Week 3 Deliverables Checklist

- [ ] Proactive notifications for new nearby food
- [ ] Role-specific AI behaviors (recipient/donor/admin)
- [ ] Natural language food queries
- [ ] Recipe generation from available items
- [ ] Voice-location search working
- [ ] Admin AI Logs page at `/admin/ai-logs`
- [ ] Full QA passing across browsers + mobile

---

### WEEK 4 — Bug Fixes, Polish, Operational Readiness ($300)

**Objective**: Production-grade reliability. Edge case handling. Monitoring. Accessibility.

#### Task 4.1: Context Management

- Sliding window: last 20 messages + re-inject system prompt + user profile each turn
- Prevent context drift in long conversations
- Detect when conversation topic changes, reset partial context

#### Task 4.2: Edge Case Fixes

- Reminder race conditions: row-level locking in PostgreSQL
- iOS Safari audio: "Tap to hear" button for auto-play restrictions
- Spanish pronunciation: normalize text before TTS
- Tool validation: handle empty results, expired items, permission errors
- Rate limit abuse: per-user throttling (50 req/min)

#### Task 4.3: Feedback System

- Thumbs up/down on each AI response → saves to `ai_feedback`
- Optional comment field for "not helpful" responses
- Feedback informs training data updates

#### Task 4.4: UI Polish

- Smooth open/close animations on chat panel
- Lazy-load chat panel (code splitting)
- Chat panel loads < 500ms on mobile
- Dark mode compatibility
- Avatar and branding refinement

#### Task 4.5: Accessibility

- Keyboard navigation through chat panel
- Screen reader labels for all interactive elements
- High contrast support
- Focus management when panel opens/closes
- ARIA live region for new messages

#### Task 4.6: Training Data Refinement

- Update `ai_training_data.json` based on:
  - Common questions that got poor responses
  - New platform features
  - Feedback patterns from `ai_feedback`
- No model retraining — system prompt updates only

#### Task 4.7: Admin Monitoring

- AI usage dashboard in admin panel
- Error rate tracking (target < 5%)
- Conversation quality metrics from feedback
- Tool success/failure rates

#### Week 4 Deliverables Checklist

- [ ] Error rate < 5% on AI responses
- [ ] Voice works: Chrome, Safari, Firefox (desktop + mobile)
- [ ] Spanish end-to-end on mobile
- [ ] Reminders fire within 15 min of trigger time
- [ ] SMS respects opt-out preferences
- [ ] Admin logs viewable at `/admin/ai-logs`
- [ ] Feedback logging active
- [ ] Chat panel loads < 500ms on mobile
- [ ] Graceful anonymous mode
- [ ] Rate limiter prevents abuse
- [ ] Accessibility audit passed

---

## File Inventory

### New Files to Create (10)

| #   | File                                       | Purpose                                             | Week |
| --- | ------------------------------------------ | --------------------------------------------------- | ---- |
| 1   | `supabase/functions/ai-chat/index.ts`      | Edge Function: AI chat with DeepSeek + tool calling | 1    |
| 2   | `utils/services/aiChatService.js`          | Client service: conversation management             | 1    |
| 3   | `utils/hooks/useAIChat.js`                 | React hook: chat state, voice, history              | 1    |
| 4   | `components/assistant/AIChatPanel.jsx`     | Chat bubble + panel UI                              | 1    |
| 5   | `components/assistant/VoiceInput.jsx`      | Web Speech API mic input                            | 1    |
| 6   | `components/assistant/VoiceOutput.jsx`     | Browser TTS output                                  | 1    |
| 7   | `supabase/functions/ai-reminders/index.ts` | Cron: send pending reminders                        | 2    |
| 8   | `pages/admin/AILogs.jsx`                   | Admin AI monitoring dashboard                       | 3    |
| 9   | `tests/AIChatPanel.test.js`                | Chat panel unit tests                               | 1    |
| 10  | `tests/useAIChat.test.js`                  | Hook unit tests                                     | 1    |

### Files to Modify (4)

| #   | File                               | Changes                                                | Week |
| --- | ---------------------------------- | ------------------------------------------------------ | ---- |
| 1   | `utils/dataService.js`             | Add 6 AI CRUD methods                                  | 1    |
| 2   | `components/layout/MainLayout.jsx` | Add `<AIChatPanel />`, remove old AIAssistant comments | 1    |
| 3   | `app.jsx`                          | Add `/admin/ai-logs` route                             | 3    |
| 4   | `utils/config.js`                  | Add optional OPENAI_API_KEY for upgrade path           | 1    |

### Existing Files (Keep as-is)

| File                                                | Reason                                              |
| --------------------------------------------------- | --------------------------------------------------- |
| `supabase/migrations/20260327_create_ai_tables.sql` | Already complete with all 3 tables + RLS            |
| `supabase/functions/ai-chat/ai_training_data.json`  | 5000+ lines of training data already built          |
| `utils/deepseekChat.js`                             | DeepSeek streaming client — working                 |
| `utils/deepseekClient.js`                           | HTTP client with retry — working                    |
| `utils/aiAgent.js`                                  | Rate limiter + circuit breaker — working            |
| `components/assistant/AIAssistant.jsx`              | Keep for reference, will be replaced by AIChatPanel |

---

## Key Design Decisions

1. **New AIChatPanel vs upgrading AIAssistant**: Building fresh allows purpose-built voice integration, tool result rendering, and action cards from the ground up rather than bolting onto a text-only chat modal.

2. **Edge Function over client-side AI calls**: Server-side reasoning keeps the API key secure, enables DB access for tools, and centralizes conversation management. The client never touches DeepSeek directly.

3. **Confirmation before destructive actions**: AI will always ask "Shall I claim this?" / "Shall I post this listing?" before write operations. Users stay in control.

4. **Tool calling over free-form responses**: DeepSeek function calling returns structured JSON for actions. More reliable than trying to parse free-form text into platform actions.

5. **Progressive enhancement**: Voice is optional. If browser doesn't support Speech API, the mic button hides. Text chat always works. Anonymous users get limited but useful responses.

6. **Lazy-loading the chat panel**: AIChatPanel loads only when the bubble is clicked. Keeps page load fast for users who don't need AI.

---

## Getting Started — Implementation Order

```
START HERE
    │
    ▼
[1] Add AI methods to dataService.js (Task 1.1)
    │
    ▼
[2] Create ai-chat Edge Function (Task 1.2)
    │   — Can test with curl/Postman at this point
    ▼
[3] Create aiChatService.js (Task 1.3)
    │
    ▼
[4] Create useAIChat.js hook (Task 1.4)
    │
    ▼
[5] Create VoiceInput.jsx + VoiceOutput.jsx (Tasks 1.6, 1.7)
    │
    ▼
[6] Create AIChatPanel.jsx (Task 1.5)
    │   — Uses hook + voice components
    ▼
[7] Wire into MainLayout.jsx (Task 1.8)
    │   — AI chat visible on every page!
    ▼
[8] Write tests (Task 1.9)
    │
    ▼
WEEK 1 COMPLETE ✅ — User can chat with Nourish via text and voice
    │
    ▼
[9] Implement tool handlers in Edge Function (Tasks 2.1–2.4)
    │
    ▼
[10] Build reminder system (Task 2.5)
    │
    ▼
[11] Spanish support (Task 2.6) + Anonymous mode (Task 2.7)
    │
    ▼
WEEK 2 COMPLETE ✅ — AI searches food, claims items, creates reminders
    │
    ▼
... Weeks 3–4 continue as outlined above
```

---

## Success Metrics

| Metric                     | Target              | How to Measure                                 |
| -------------------------- | ------------------- | ---------------------------------------------- |
| AI response success rate   | > 95%               | `ai_conversations` count vs. error count       |
| Avg response time          | < 3 seconds         | Edge Function execution time                   |
| Voice recognition accuracy | > 85%               | Compare transcript to intended input           |
| User satisfaction          | > 80% helpful       | `ai_feedback` helpful vs. not_helpful ratio    |
| Chat panel load time       | < 500ms             | Lighthouse performance audit                   |
| Spanish accuracy           | > 90%               | Manual QA + user feedback                      |
| Reminder delivery          | < 15 min of trigger | `ai_reminders.trigger_time` vs `sent_at`       |
| Daily active AI users      | Track growth        | Unique `user_id` in `ai_conversations` per day |

---

_Ready to build. Starting with Week 1, Task 1.1._
