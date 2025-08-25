export const defaultTransportItems = [
    {
      item: "Airport Transfer",
      description: "Book a private car or shuttle to or from the airport.",
      category: "transport",
      department: "front_desk",
      tags: ["airport_shuttle", "airport_car", "hotel_transfer", "arrival_departure"],
      is_paid: true,
      price: null, 
      currency: null, 
      is_upsell: false, // Can be an upsell if presented proactively
      is_active: true,
      requires_quantity: false, // Details like num_passengers, flight_info taken in flow
      requires_time: true, // Transfer time is crucial
      request_type: "service",
      cooldown_minutes: null
    },
    {
      item: "Taxi Service",
      description: "Book a taxi for local transportation.",
      category: "transport",
      department: "front_desk",
      tags: ["taxi_booking", "cab_service", "local_ride", "getting_around"],
      is_paid: true, // Or metered, hotel might just facilitate booking
      price: null, 
      currency: null, 
      is_upsell: false,
      is_active: true,
      requires_quantity: false,
      requires_time: true, // Pickup time
      max_quantity: null,
      request_type: "service",
      cooldown_minutes: null
    },
    {
      item: "City Tour",
      description: "Guided city tour with options for hotel transportation.",
      category: "transport", // Or "activities" if you add that category
      department: "front_desk",
      tags: ["city_tour_booking", "sightseeing_trip", "guided_excursion", "local_attractions"],
      is_paid: true,
      price: null, 
      currency: null, 
      is_upsell: true,
      is_active: true,
      requires_quantity: false, // Num_participants taken in flow
      requires_time: true, // Tour date/time
      max_quantity: null,
      request_type: "service",
      cooldown_minutes: null
    },
    {
      item: "Rental Car Booking",
      description: "Assistance with booking a rental car through our partners.",
      category: "transport",
      department: "front_desk",
      tags: ["car_rental", "hire_car", "vehicle_booking", "self_drive"],
      is_paid: false, // Hotel facilitates, car rental company charges
      price: null,
      currency: null,
      is_upsell: false,
      is_active: true,
      requires_quantity: false,
      requires_time: true, // Pickup dates/times
      request_type: "service",
      cooldown_minutes: null
    },
    {
      item: "Public Transport Information",
      description: "Get information on local bus, train, or subway routes and schedules.",
      category: "transport",
      department: "front_desk",
      tags: ["public_transit", "bus_info", "train_schedule", "subway_routes", "local_travel_advice"],
      is_paid: false,
      price: null,
      currency: null,
      is_upsell: false,
      is_active: true,
      requires_quantity: false,
      requires_time: false,
      request_type: "faq", // This is more of an informational request
      cooldown_minutes: 0
    }
]; 