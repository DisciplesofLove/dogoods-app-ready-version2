import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Load training data
const trainingData = JSON.parse(
  await Deno.readTextFile(new URL('./ai_training_data.json', import.meta.url))
)

// Tool definitions for OpenAI function calling
const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'search_food_nearby',
      description: 'Search for available food listings near a location. Returns food items sorted by distance.',
      parameters: {
        type: 'object',
        properties: {
          latitude: { type: 'number', description: 'User latitude' },
          longitude: { type: 'number', description: 'User longitude' },
          radius_miles: { type: 'number', description: 'Search radius in miles (default 5)' },
          category: { type: 'string', description: 'Food category filter: produce, dairy, bakery, pantry, meat, prepared' },
          dietary_filter: { type: 'string', description: 'Dietary filter: vegan, vegetarian, gluten-free, halal, kosher' },
        },
        required: ['latitude', 'longitude'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_user_profile',
      description: 'Get the current user profile including dietary restrictions, location, and preferences.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pickup_status',
      description: 'Check the user\'s active food claims and upcoming pickups.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_listings',
      description: 'Get the user\'s food listings and their current status (for donors).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_reminder',
      description: 'Create a reminder for the user. Examples: pickup reminders, event reminders, or custom reminders.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Reminder message text' },
          trigger_time: { type: 'string', description: 'ISO 8601 datetime for when to send the reminder' },
          reminder_type: { type: 'string', enum: ['pickup', 'listing_expiry', 'distribution_event', 'general'], description: 'Type of reminder' },
          related_id: { type: 'string', description: 'Optional UUID of related food_claim, food_listing or distribution_event' },
        },
        required: ['message', 'trigger_time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_distribution_events',
      description: 'Get upcoming community food distribution events.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max number of events to return (default 5)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'claim_food',
      description: 'Claim a food listing for the user. Requires the listing ID. Always confirm with the user before calling this.',
      parameters: {
        type: 'object',
        properties: {
          listing_id: { type: 'string', description: 'UUID of the food listing to claim' },
          notes: { type: 'string', description: 'Optional notes from the claimer' },
        },
        required: ['listing_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_food_listing',
      description: 'Create a new food listing on behalf of the donor. Always confirm details with the user before posting.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title of the food listing' },
          description: { type: 'string', description: 'Description of the food being shared' },
          category: { type: 'string', enum: ['produce', 'dairy', 'bakery', 'pantry', 'meat', 'prepared'], description: 'Food category' },
          quantity: { type: 'number', description: 'Number of servings or items' },
          pickup_address: { type: 'string', description: 'Address for pickup' },
          pickup_time: { type: 'string', description: 'Pickup time window description' },
          expiry_date: { type: 'string', description: 'ISO 8601 date when the food expires' },
          dietary_tags: { type: 'array', items: { type: 'string' }, description: 'Dietary tags: vegan, vegetarian, gluten-free, etc.' },
        },
        required: ['title', 'description', 'category'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_platform_stats',
      description: 'Get platform statistics (admin only). Includes claim counts, listing counts, and user activity.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['today', 'week', 'month', 'all'], description: 'Time period for stats' },
        },
        required: [],
      },
    },
  },
]

// Haversine distance in miles
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3959 // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Execute tool calls against the database
async function executeTool(toolName, args, supabaseClient, userId, isAdmin) {
  switch (toolName) {
    case 'search_food_nearby': {
      const { latitude, longitude, radius_miles = 5, category, dietary_filter } = args
      let query = supabaseClient
        .from('food_listings')
        .select('id, title, description, category, quantity, pickup_address, pickup_time, expiry_date, dietary_tags, latitude, longitude, created_at, status')
        .in('status', ['approved', 'active'])
        .gte('expiry_date', new Date().toISOString())

      if (category) query = query.eq('category', category)

      const { data, error } = await query.limit(50)
      if (error) return { error: error.message }

      // Filter by distance and dietary restrictions
      let results = (data || [])
        .map(item => ({
          ...item,
          distance_miles: item.latitude && item.longitude
            ? Math.round(haversineDistance(latitude, longitude, item.latitude, item.longitude) * 10) / 10
            : null,
        }))
        .filter(item => item.distance_miles !== null && item.distance_miles <= radius_miles)
        .sort((a, b) => a.distance_miles - b.distance_miles)

      if (dietary_filter) {
        results = results.filter(item =>
          item.dietary_tags && item.dietary_tags.some(tag =>
            tag.toLowerCase().includes(dietary_filter.toLowerCase())
          )
        )
      }

      return {
        count: results.length,
        listings: results.slice(0, 10).map(item => ({
          id: item.id,
          title: item.title,
          description: item.description,
          category: item.category,
          quantity: item.quantity,
          pickup_address: item.pickup_address,
          pickup_time: item.pickup_time,
          expiry_date: item.expiry_date,
          dietary_tags: item.dietary_tags,
          distance_miles: item.distance_miles,
        })),
      }
    }

    case 'get_user_profile': {
      if (!userId) return { error: 'User not authenticated' }
      const { data, error } = await supabaseClient
        .from('users')
        .select('id, full_name, email, dietary_restrictions, location, phone, avatar_url, is_admin, created_at')
        .eq('id', userId)
        .single()

      if (error) return { error: error.message }
      return { profile: data }
    }

    case 'get_pickup_status': {
      if (!userId) return { error: 'User not authenticated' }
      const { data, error } = await supabaseClient
        .from('food_claims')
        .select('id, status, created_at, notes, food_listings(id, title, description, category, pickup_address, pickup_time, expiry_date)')
        .eq('user_id', userId)
        .in('status', ['pending', 'approved'])
        .order('created_at', { ascending: false })
        .limit(10)

      if (error) return { error: error.message }
      return { claims: data || [] }
    }

    case 'get_my_listings': {
      if (!userId) return { error: 'User not authenticated' }
      const { data, error } = await supabaseClient
        .from('food_listings')
        .select('id, title, description, category, quantity, status, pickup_address, pickup_time, expiry_date, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10)

      if (error) return { error: error.message }
      return { listings: data || [] }
    }

    case 'create_reminder': {
      if (!userId) return { error: 'User not authenticated' }
      const { message, trigger_time, reminder_type = 'general', related_id } = args
      const insertData = {
        user_id: userId,
        message,
        trigger_time,
        reminder_type,
      }
      if (related_id) insertData.related_id = related_id

      const { data, error } = await supabaseClient
        .from('ai_reminders')
        .insert(insertData)
        .select()
        .single()

      if (error) return { error: error.message }
      return { reminder: data, success: true }
    }

    case 'get_distribution_events': {
      const { limit = 5 } = args
      const { data, error } = await supabaseClient
        .from('distribution_events')
        .select('id, title, description, location, event_date, start_time, end_time, capacity, registered_count, status')
        .gte('event_date', new Date().toISOString().split('T')[0])
        .eq('status', 'scheduled')
        .order('event_date', { ascending: true })
        .limit(limit)

      if (error) return { error: error.message }
      return { events: data || [] }
    }

    case 'claim_food': {
      if (!userId) return { error: 'User not authenticated' }
      const { listing_id, notes } = args

      // Check listing exists and is available
      const { data: listing, error: listingError } = await supabaseClient
        .from('food_listings')
        .select('id, title, status, user_id')
        .eq('id', listing_id)
        .single()

      if (listingError || !listing) return { error: 'Listing not found' }
      if (!['approved', 'active'].includes(listing.status)) return { error: 'Listing is no longer available' }
      if (listing.user_id === userId) return { error: 'You cannot claim your own listing' }

      // Check existing claims
      const { data: existingClaim } = await supabaseClient
        .from('food_claims')
        .select('id')
        .eq('user_id', userId)
        .eq('food_listing_id', listing_id)
        .in('status', ['pending', 'approved'])
        .single()

      if (existingClaim) return { error: 'You already have an active claim on this listing' }

      const { data, error } = await supabaseClient
        .from('food_claims')
        .insert({
          user_id: userId,
          food_listing_id: listing_id,
          status: 'pending',
          notes: notes || null,
        })
        .select()
        .single()

      if (error) return { error: error.message }
      return { claim: data, success: true, message: `Claimed "${listing.title}" successfully! The donor will be notified.` }
    }

    case 'create_food_listing': {
      if (!userId) return { error: 'User not authenticated' }
      const { title, description, category, quantity, pickup_address, pickup_time, expiry_date, dietary_tags } = args

      const { data, error } = await supabaseClient
        .from('food_listings')
        .insert({
          user_id: userId,
          title,
          description,
          category: category || 'pantry',
          quantity: quantity || 1,
          pickup_address: pickup_address || null,
          pickup_time: pickup_time || null,
          expiry_date: expiry_date || null,
          dietary_tags: dietary_tags || [],
          status: 'pending',
          listing_type: 'donation',
        })
        .select()
        .single()

      if (error) return { error: error.message }
      return { listing: data, success: true, message: `Listing "${title}" created! An admin will review it shortly.` }
    }

    case 'get_platform_stats': {
      if (!isAdmin) return { error: 'Admin access required' }
      const { period = 'week' } = args

      let dateFilter = new Date()
      if (period === 'today') dateFilter.setHours(0, 0, 0, 0)
      else if (period === 'week') dateFilter.setDate(dateFilter.getDate() - 7)
      else if (period === 'month') dateFilter.setMonth(dateFilter.getMonth() - 1)
      else dateFilter = new Date(0)

      const dateStr = dateFilter.toISOString()

      const [listings, claims, users] = await Promise.all([
        supabaseClient.from('food_listings').select('id', { count: 'exact' }).gte('created_at', dateStr),
        supabaseClient.from('food_claims').select('id', { count: 'exact' }).gte('created_at', dateStr),
        supabaseClient.from('users').select('id', { count: 'exact' }).gte('created_at', dateStr),
      ])

      return {
        period,
        listings_count: listings.count || 0,
        claims_count: claims.count || 0,
        new_users_count: users.count || 0,
      }
    }

    default:
      return { error: `Unknown tool: ${toolName}` }
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Parse request
    const { message, conversation_history = [], user_location = null } = await req.json()

    if (!message || typeof message !== 'string') {
      throw new Error('Message is required')
    }

    // Create Supabase client with service role for DB operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Get user from auth header (optional — anonymous mode if missing)
    let userId = null
    let userProfile = null
    let isAdmin = false
    const authHeader = req.headers.get('Authorization')

    if (authHeader) {
      const supabaseAuth = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { auth: { autoRefreshToken: false, persistSession: false } }
      )

      const token = authHeader.replace('Bearer ', '')
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token)

      if (!authError && user) {
        userId = user.id

        // Fetch user profile
        const { data: profile } = await supabaseAdmin
          .from('users')
          .select('full_name, email, dietary_restrictions, location, phone, is_admin')
          .eq('id', userId)
          .single()

        if (profile) {
          userProfile = profile
          isAdmin = profile.is_admin === true
        }
      }
    }

    // Build system prompt
    let systemPrompt = trainingData.system_prompt + '\n\n' + trainingData.spanish_rules

    // Add user context if authenticated
    if (userProfile) {
      systemPrompt += `\n\nCurrent user context:
- Name: ${userProfile.full_name || 'Unknown'}
- Role: ${isAdmin ? 'Admin' : 'Member'}
- Dietary restrictions: ${userProfile.dietary_restrictions || 'None specified'}
- Location: ${userProfile.location || 'Not set'}
- Has phone: ${userProfile.phone ? 'Yes' : 'No'}`
    } else {
      systemPrompt += '\n\nThe user is NOT logged in (anonymous). Only provide general platform info. Do not access personal data or create reminders/claims. Suggest signing in for personalized help.'
    }

    if (user_location) {
      systemPrompt += `\n- Current GPS: ${user_location.latitude}, ${user_location.longitude}`
    }

    // Build messages for OpenAI
    const messages = [
      { role: 'system', content: systemPrompt },
      // Include recent conversation history (max 20 messages for context window)
      ...conversation_history.slice(-20).map(msg => ({
        role: msg.role,
        content: msg.message || msg.content,
      })),
      { role: 'user', content: message },
    ]

    // Get OpenAI API key
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY not configured')
    }

    // Call OpenAI with function calling
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        tools: userId ? toolDefinitions : toolDefinitions.filter(t =>
          ['search_food_nearby', 'get_distribution_events'].includes(t.function.name)
        ),
        tool_choice: 'auto',
        temperature: 0.7,
        max_tokens: 1500,
      }),
    })

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text()
      console.error('OpenAI API error:', openaiResponse.status, errorText)
      throw new Error(`AI service error: ${openaiResponse.status}`)
    }

    let aiResult = await openaiResponse.json()
    let assistantMessage = aiResult.choices?.[0]?.message
    let toolResults = []

    // Handle tool calls (may need multiple rounds)
    let toolRounds = 0
    const MAX_TOOL_ROUNDS = 3

    while (assistantMessage?.tool_calls && toolRounds < MAX_TOOL_ROUNDS) {
      toolRounds++
      const toolCallMessages = []

      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name
        let toolArgs = {}
        try {
          toolArgs = JSON.parse(toolCall.function.arguments)
        } catch { /* empty args */ }

        console.log(`Executing tool: ${toolName}`, toolArgs)
        const result = await executeTool(toolName, toolArgs, supabaseAdmin, userId, isAdmin)
        toolResults.push({ tool: toolName, args: toolArgs, result })

        toolCallMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        })
      }

      // Send tool results back to OpenAI for final response
      messages.push(assistantMessage)
      messages.push(...toolCallMessages)

      const followUpResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages,
          tools: userId ? toolDefinitions : toolDefinitions.filter(t =>
            ['search_food_nearby', 'get_distribution_events'].includes(t.function.name)
          ),
          tool_choice: 'auto',
          temperature: 0.7,
          max_tokens: 1500,
        }),
      })

      if (!followUpResponse.ok) {
        console.error('OpenAI follow-up error:', followUpResponse.status)
        break
      }

      aiResult = await followUpResponse.json()
      assistantMessage = aiResult.choices?.[0]?.message
    }

    const responseText = assistantMessage?.content || "I'm sorry, I couldn't process that request. Please try again."

    // Save conversation to database if user is authenticated
    if (userId) {
      // Save user message
      await supabaseAdmin.from('ai_conversations').insert({
        user_id: userId,
        role: 'user',
        message,
        metadata: { user_location },
      })

      // Save assistant response
      await supabaseAdmin.from('ai_conversations').insert({
        user_id: userId,
        role: 'assistant',
        message: responseText,
        metadata: { tool_calls: toolResults, model: 'gpt-4o-mini' },
      })
    }

    // Determine suggested quick actions based on context
    const suggestedActions = []
    if (!userId) {
      suggestedActions.push({ label: 'Sign in for more features', action: 'navigate', target: '/login' })
    }
    if (user_location) {
      suggestedActions.push({ label: 'Find food near me', action: 'send', message: 'What food is available near me?' })
    }
    suggestedActions.push({ label: 'How does DoGoods work?', action: 'send', message: 'How does DoGoods work?' })

    return new Response(
      JSON.stringify({
        response: responseText,
        tool_results: toolResults,
        suggested_actions: suggestedActions,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    console.error('AI chat error:', error)

    return new Response(
      JSON.stringify({
        response: "I'm having a little trouble right now. Please try again in a moment. If this keeps happening, you can still browse food listings directly on the Find Food page.",
        error: error.message,
        tool_results: [],
        suggested_actions: [
          { label: 'Try again', action: 'retry' },
          { label: 'Browse food listings', action: 'navigate', target: '/find-food' },
        ],
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200, // Return 200 even on error so the chat UI can display the friendly message
      }
    )
  }
})
