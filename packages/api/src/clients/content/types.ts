export enum SpamCode {
  LOW = 0, // same as isSpam = false on TokenProject
  MEDIUM = 1, // same as isSpam = true on TokenProject
  HIGH = 2, // has a URL in token name
}

/**
 * These Ranking Types are not currently included in the protbufs generated types. For now will specify here
 * and remove when added to protobuf.
 * the Explore backend model types#L19-L30
 */
export enum RankingType {
  TotalValueLocked = 'TOTAL_VALUE_LOCKED',
  MarketCap = 'MARKET_CAP',
  Volume = 'VOLUME',
}

export enum CustomRankingType {
  PricePercentChange1DayAsc = 'PRICE_PERCENT_CHANGE_1_DAY_ASC',
  PricePercentChange1DayDesc = 'PRICE_PERCENT_CHANGE_1_DAY_DESC',
  Trending = 'TRENDING',
}
