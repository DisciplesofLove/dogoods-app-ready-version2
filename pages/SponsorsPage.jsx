import React from "react";
import { Link } from "react-router-dom";
import supabase from "../utils/supabaseClient";
import cheeseBoard from "./sponsoredby/cheese_board.png";
import community from "./sponsoredby/community.png";
import farm from "./sponsoredby/farm.png";
import feedingElmeda from "./sponsoredby/feeding_elmeda.png";
import feelGoodBakery from "./sponsoredby/feel_good_backery.png";
import shareChicken from "./sponsoredby/sharechicken.png";
import sharePizza from "./sponsoredby/sharepizza.png";
import aclc from "./sponsoredby/ACLC.jpg";
import allGoodLiving from "./sponsoredby/allgoodliving.jpg";
import island from "./sponsoredby/island.jpg";
import jets from "./sponsoredby/jets.jpg";
import ruby from "./sponsoredby/Ruby.jpg";
import theAcademy from "./sponsoredby/the academy.jpg";
import foodrecovery from "./sponsoredby/foodrecovery.png";
import foodshift from "./sponsoredby/foodshift.png";

const localSponsors = [
  {
    name: "The Cheese Board Collective",
    img: cheeseBoard,
    website: "https://cheeseboardcollective.coop/",
    description: "A worker-owned cooperative bakery and pizzeria in Berkeley since 1971",
    food_saved_from_waste_lb: 2500,
    food_donated_lb: 1800
  },
  {
    name: "Alameda County Community Food bank",
    img: community,
    website: "https://accfb.org",
    description: "the Alameda County community food Bank is non-profit organization that supplies food to 400+ Alameda County.",
    food_saved_from_waste_lb: 15000,
    food_donated_lb: 12500
  },
  {
    name: "Semifreddi's",
    img: farm,
    website: "https://www.semifreddis.com/",
    description: "Semifreddi's Bakery is an Alameda-based artisan backery that serves the entire San Francisco Bay Area.",
    food_saved_from_waste_lb: 3200,
    food_donated_lb: 2900
  },
  {
    name: "Alameda Food Bank",
    img: feedingElmeda,
    website: "https://www.alamedafoodbank.org/",
    description: "Founded in 1977, the Alameda Food Bank is a non-profit organization that helps Alameda community by providing nourishing food to those in need.",
    food_saved_from_waste_lb: 8500,
    food_donated_lb: 7200
  },
  {
    name: "Community Kitchen",
    img: shareChicken,
    website: "https://www.ckoakland.org/",
    description: "Community Kichen's mission is to harness the power of food to change lives, uplift communities and protect our enviroment.",
    food_saved_from_waste_lb: 4500,
    food_donated_lb: 4100
  },
  {
    name: "Berkeley Pizza Collective",
    img: sharePizza,
    website: "https://www.sharepizzakitchen.com",
    description: "We specialize in sourdough pizza with craft that is crispy on outside, soft on the inside, and taste like sourdough when you bite into it",
    food_saved_from_waste_lb: 1200,
    food_donated_lb: 950
  },
  {
    name: "Food shift",
    img: foodshift,
    website: "https://foodshift.net",
    description: "At Food Shift, we transform surplus into opportunities. Since 2012, we've been reducing food waste and nourishing neighbors in the San Francisco Bay Area while sharing solutions globally. Together, we're building a stronger, more equitable food system",
    food_saved_from_waste_lb: 18500,
    food_donated_lb: 16200
  },
  {
    name: "Food recovery",
    img: foodrecovery,
    website: "https//foodrecovery.org",
    description: "We connect food donors with nonprofits to fight hunger and reduce waste. Our solutions make it easy to donate or receive food while helping the environment. All for free.",
    food_saved_from_waste_lb: 22000,
    food_donated_lb: 19500
  },
  {
    name: "Trybe Inc.",
    img: null,
    website: "https://www.trybeinc.org",
    description: "Trybe Inc. is a community-based non-profit rooted in Oakland's Eastlake/San Antonio/Fruitvale area, serving youth, young adults, and families in Oakland, Berkeley, Richmond, Hayward and the greater East Bay Area.",
    food_saved_from_waste_lb: 0,
    food_donated_lb: 0
  }
];

function SponsorsPage() {
  const [sponsors, setSponsors] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetchSponsors();
  }, []);

  const fetchSponsors = async () => {
    try {
      const { data, error } = await supabase
        .from('sponsors')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        // Merge database sponsors with local logo images
        const mergedSponsors = data.map(dbSponsor => {
          const localSponsor = localSponsors.find(s => s.name === dbSponsor.name);
          return {
            ...dbSponsor,
            img: localSponsor?.img || dbSponsor.logo_url,
            description: dbSponsor.description || localSponsor?.description || '',
            website: dbSponsor.website || localSponsor?.website || '',
            // Use database values directly
            food_saved_from_waste_lb: parseFloat(dbSponsor.food_saved_from_waste_lb) || 0,
            food_donated_lb: parseFloat(dbSponsor.food_donated_lb) || 0
          };
        });
        setSponsors(mergedSponsors);
      } else {
        // Fallback to local sponsors if no database entries
        setSponsors(localSponsors);
      }
    } catch (error) {
      console.error('Error fetching sponsors:', error);
      setSponsors(localSponsors);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Our Sponsors</h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            We are grateful for the support of these amazing organizations that help make DoGoods possible.
            Their commitment to food security and community building aligns perfectly with our mission.
          </p>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#2CABE3] mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading sponsors...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {sponsors.map((sponsor) => {
              // Extract metric values
              const foodSavedValue = Math.round(sponsor.food_saved_from_waste_lb || 0);
              const foodDonatedValue = Math.round(sponsor.food_donated_lb || 0);
              
              return (
            <div
              key={sponsor.id || sponsor.name}
              className="bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow duration-300 overflow-hidden"
            >
              <div className="h-48 bg-gray-100 flex items-center justify-center p-6">
                {sponsor.img ? (
                  <img
                    src={sponsor.img}
                    alt={sponsor.name + ' logo'}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-gray-400">
                    <i className="fas fa-building text-5xl mb-2"></i>
                    <span className="text-sm font-medium">{sponsor.name}</span>
                  </div>
                )}
              </div>
              <div className="p-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  {sponsor.name}
                </h3>
                <p className="text-gray-600 text-sm mb-4">
                  {sponsor.description}
                </p>

                <div className="mb-4 space-y-2 bg-[#2CABE3]/10 p-3 rounded-lg">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 font-medium">
                      <i className="fas fa-leaf text-[#2CABE3] mr-2"></i>
                      Food Saved from Waste (lb)
                    </span>
                    <span className="text-[#2CABE3] font-bold">{foodSavedValue.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 font-medium">
                      <i className="fas fa-hands-helping text-[#2CABE3] mr-2"></i>
                      Food Donated (lb)
                    </span>
                    <span className="text-[#2CABE3] font-bold">{foodDonatedValue.toLocaleString()}</span>
                  </div>
                </div>

                {sponsor.website && sponsor.website !== "#" && (
                  <a
                    href={sponsor.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-[#2CABE3] hover:opacity-80 font-medium text-sm"
                  >
                    Visit Website
                    <i className="fas fa-external-link-alt ml-2 text-xs"></i>
                  </a>
                )}
                {sponsor.website === "#" && (
                  <span className="text-gray-400 text-sm">
                    Website coming soon
                  </span>
                )}
              </div>
            </div>
          )})}
          </div>
        )}

        <div className="mt-16 bg-white rounded-lg shadow-md p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            Become a Sponsor
          </h2>
          <p className="text-gray-600 mb-6 max-w-2xl mx-auto">
            Interested in supporting our mission to reduce food waste and strengthen communities?
            We'd love to partner with you!
          </p>
          <Link
            to="/contact"
            className="inline-block bg-[#2CABE3] text-white px-8 py-3 rounded-lg font-medium hover:opacity-90 transition-all duration-200"
          >
            Contact Us About Sponsorship
          </Link>
        </div>
      </div>
    </div>
  );
}

export default SponsorsPage;
