export const defaultServiceItems = [
    {
      item: "Room Cleaning",
      description: "Housekeeping will clean your room.",
      category: "service",
      department: "housekeeping",
      tags: ["cleaning", "housekeeping", "room_cleaning", "maid_service"],
      is_paid: false,
      price: null,
      currency: null,
      is_upsell: false,
      is_active: true,
      requires_quantity: false,
      requires_time: true, // Guest might specify a preferred time or ASAP
      max_quantity: null,
      request_type: "service",
      cooldown_minutes: 180
    },
    {
      item: "Wake-Up Call",
      description: "A staff member will call you at the requested time.",
      category: "service",
      department: "front_desk",
      tags: ["wake_up", "alarm", "wake_up_call", "morning_call"],
      is_paid: false,
      price: null,
      currency: null,
      is_upsell: false,
      is_active: true,
      requires_quantity: false,
      requires_time: true, // Specific time is crucial
      request_type: "service",
      cooldown_minutes: 0 // Can request multiple for different times
    },
    {
      item: "Laundry Service",
      description: "Professional laundry service for your clothing.",
      category: "service",
      department: "housekeeping",
      tags: ["laundry", "dry_cleaning", "clothes_cleaning", "pressing"],
      is_paid: true,
      price: null, 
      currency: null, 
      is_upsell: false,
      is_active: true,
      requires_quantity: false, // Typically by bag or item count, handled by staff
      requires_time: true, // Pickup/delivery times
      max_quantity: null,
      request_type: "service",
      cooldown_minutes: null
    },
    {
      item: "Room Service Menu",
      description: "Order food and beverages to your room from our menu.",
      category: "service",
      department: "kitchen",
      tags: ["room_service_food", "in_room_dining", "food_delivery", "menu_order"],
      is_paid: true, // The service of ordering is free, items on menu are paid
      price: null, // Price is per item on menu, not for the 'service' of ordering
      currency: null, 
      is_upsell: false,
      is_active: true,
      requires_quantity: false, // Specific items/quantities handled within menu flow
      requires_time: true, // Delivery time estimate
      max_quantity: null,
      request_type: "service",
      cooldown_minutes: 30
    },
    {
      item: "Luggage Storage",
      description: "Store your luggage safely before check-in or after checkout.",
      category: "service",
      department: "front_desk",
      tags: ["luggage_storage", "baggage_hold", "store_bags", "bell_desk"],
      is_paid: false,
      price: null,
      currency: null,
      is_upsell: false,
      is_active: true,
      requires_quantity: false, // Can ask for number of bags if needed for staff note
      requires_time: false,
      max_quantity: null,
      request_type: "service",
      cooldown_minutes: null
    },
    {
      item: "Restaurant Reservation",
      description: "Make a reservation at the hotel restaurant or nearby partner restaurants.",
      category: "service",
      department: "kitchen",
      tags: ["restaurant_booking", "table_reservation", "dining_reservation", "food_table"],
      is_paid: false,
      price: null,
      currency: null,
      is_upsell: false,
      is_active: true,
      requires_quantity: false, // Details: num_guests, time, name taken in flow
      requires_time: true, // Reservation time is key
      max_quantity: null,
      request_type: "service",
      cooldown_minutes: 0
    },
    {
      item: "Spa Appointment",
      description: "Book a relaxing spa treatment or massage.",
      category: "service",
      department: "spa",
      tags: ["spa_booking", "massage_therapy", "wellness_treatment", "relaxation_service"],
      is_paid: true, 
      price: null, 
      currency: null, 
      is_upsell: true,
      is_active: true,
      requires_quantity: false, // Details: treatment type, time taken in flow
      requires_time: true, // Appointment time is key
      max_quantity: null,
      request_type: "service",
      cooldown_minutes: null
    },
    {
      item: "Express Laundry",
      description: "Same-day express laundry service for urgent needs.",
      category: "service",
      department: "housekeeping",
      tags: ["express_laundry", "same_day_cleaning", "urgent_laundry", "quick_wash"],
      is_paid: true,
      price: null, 
      currency: null, 
      is_upsell: true,
      is_active: true,
      requires_quantity: false,
      requires_time: true,
      max_quantity: null,
      request_type: "service",
      cooldown_minutes: null
    },
    {
      item: "Shoe Shine",
      description: "Professional shoe shine service.",
      category: "service",
      department: "housekeeping",
      tags: ["shoe_shine_service", "shoe_polish", "footwear_cleaning"],
      is_paid: false,
      price: null,
      currency: null,
      is_upsell: false,
      is_active: true,
      requires_quantity: false,
      requires_time: false, // Typically a drop-off/pickup system or on-request
      max_quantity: null,
      request_type: "service",
      cooldown_minutes: 240
    },
    {
      item: "Maintenance Request",
      description: "Report an issue in your room (e.g., AC, TV, plumbing).",
      category: "service",
      department: "maintenance",
      tags: ["maintenance", "repair", "fix_room", "broken_item", "engineering"],
      is_paid: false,
      price: null,
      currency: null,
      is_upsell: false,
      is_active: true,
      requires_quantity: false,
      requires_time: false, // Usually ASAP, but can note urgency
      request_type: "service",
      cooldown_minutes: 60 
    },
    {
      item: "Lost and Found",
      description: "Inquire about a lost item or report a found item.",
      category: "service",
      department: "security",
      tags: ["lost_item", "found_item", "property_inquiry", "security"],
      is_paid: false,
      price: null,
      currency: null,
      is_upsell: false,
      is_active: true,
      requires_quantity: false,
      requires_time: false,
      request_type: "service",
      cooldown_minutes: 0
    },
    {
      item: "Concierge Services",
      description: "Assistance with local information, bookings, or recommendations.",
      category: "service",
      department: "front_desk",
      tags: ["concierge", "local_info", "recommendations", "city_guide", "activity_booking"],
      is_paid: false, // Services are free, booked items might be paid
      price: null,
      currency: null,
      is_upsell: false,
      is_active: true,
      requires_quantity: false,
      requires_time: false, // Some concierge requests might be time-sensitive (e.g. last minute tickets)
      request_type: "service",
      cooldown_minutes: 0
    }
]; 