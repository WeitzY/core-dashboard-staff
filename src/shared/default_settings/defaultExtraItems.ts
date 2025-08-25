export const defaultExtraItems = [
    {
      item: "Late Checkout",
      description: "Stay in your room up to 2 hours after standard checkout time.",
      category: "extras",
      department: "front_desk",
      tags: ["late_checkout", "checkout_extension", "stay_longer", "extended_stay"],
      is_paid: true,
      price: null, 
      currency: null, 
      is_upsell: true,
      is_active: true,
      requires_quantity: false,
      requires_time: false, // Implicitly extends current stay
      request_type: "upgrade",
      cooldown_minutes: null
    },
    {
      item: "Early Check-In",
      description: "Check in to your room before standard check-in time, subject to availability.",
      category: "extras",
      department: "front_desk",
      tags: ["early_check_in", "check_in_early", "arrival_flexibility"],
      is_paid: true,
      price: null, 
      currency: null, 
      is_upsell: true,
      is_active: true,
      requires_quantity: false,
      requires_time: false, // Implicitly for current or upcoming stay
      max_quantity: null,
      request_type: "upgrade",
      cooldown_minutes: null
    },
    {
      item: "Room Upgrade",
      description: "Upgrade to a higher category room (e.g., view, suite) based on availability.",
      category: "extras",
      department: "front_desk",
      tags: ["room_upgrade", "better_room", "suite_upgrade", "view_upgrade"],
      is_paid: true,
      price: null, 
      currency: null, 
      is_upsell: true,
      is_active: true,
      requires_quantity: false,
      requires_time: false, // Applies to current stay
      max_quantity: null,
      request_type: "upgrade",
      cooldown_minutes: null
    },
    {
      item: "Flower Arrangement",
      description: "Beautiful fresh flower arrangement for your room or a special occasion.",
      category: "extras",
      department: "housekeeping",
      tags: ["flowers", "floral_arrangement", "room_decoration", "celebration_flowers"],
      is_paid: true,
      price: null, 
      currency: null, 
      is_upsell: true,
      is_active: true,
      requires_quantity: false, // Or allow choosing size/type if hotel offers
      requires_time: false, // Can request for specific time/day
      max_quantity: null,
      request_type: "upgrade", // Could also be "request" if it's more of an order
      cooldown_minutes: null
    },
    {
      item: "Pet Stay Fee",
      description: "Fee for accommodating your pet during your stay.",
      category: "extras",
      department: "front_desk",
      tags: ["pet_fee", "dog_friendly", "cat_friendly", "animal_stay"],
      is_paid: true,
      price: null, // Per night or per stay, hotel specific
      currency: null,
      is_upsell: false, // Usually a mandatory fee if bringing a pet, not an upsell
      is_active: true,
      requires_quantity: false,
      requires_time: false,
      request_type: "service", // More of a service charge than an upgrade
      cooldown_minutes: null
    },
    {
      item: "Parking",
      description: "Secure parking for your vehicle during your stay.",
      category: "extras",
      department: "front_desk",
      tags: ["car_parking", "vehicle_storage", "hotel_garage"],
      is_paid: true,
      price: null, // Per night or per stay
      currency: null,
      is_upsell: false,
      is_active: true,
      requires_quantity: false,
      requires_time: false,
      request_type: "service",
      cooldown_minutes: null
    },
    {
      item: "Rollaway Bed",
      description: "Additional rollaway bed for an extra guest in the room.",
      category: "extras",
      department: "housekeeping",
      tags: ["rollaway_bed", "extra_bed", "additional_guest_bed"],
      is_paid: true,
      price: null,
      currency: null,
      is_upsell: false,
      is_active: true,
      requires_quantity: true,
      max_quantity: 1, // Usually limit one per room
      requires_time: false,
      request_type: "request",
      cooldown_minutes: null
    }
]; 