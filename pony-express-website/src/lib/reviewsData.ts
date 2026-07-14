export interface Review {
  id: string;
  author: string;
  rating: number;
  text: string;
  source: "google" | "yelp" | "facebook";
  date?: string;
}

export const reviewsData: Review[] = [
  {
    id: "review-1",
    author: "D W",
    rating: 5,
    text: "Great tacos and burritos, fair prices, and excellent owner, manager and staff!",
    source: "google",
  },
  {
    id: "review-2",
    author: "Yecenia Ponciano",
    rating: 5,
    text: "Delicious food, the gentleman in the morning gives great customer service!",
    source: "google",
  },
  {
    id: "review-3",
    author: "Byron Taylor",
    rating: 5,
    text: "Best burritos in Amarillo and cheaper than Sharky's too!",
    source: "facebook",
  },
  {
    id: "review-4",
    author: "Drew Burb",
    rating: 3,
    text: "Rice was dry bean are cold meat ok, small place.",
    source: "google",
  },
];

export const overallRating = 4.6;
export const totalReviews = 107;
