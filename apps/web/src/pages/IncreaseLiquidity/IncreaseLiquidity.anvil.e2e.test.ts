import { getPosition } from '@uniswap/client-data-api/dist/data/v1/api-DataApiService_connectquery'
import { LiquidityService } from '@uniswap/client-liquidity/dist/uniswap/liquidity/v2/api_connect'
import { USDT } from 'uniswap/src/constants/tokens'
import { TestID } from 'uniswap/src/test/fixtures/testIDs'
import { getUniswapServiceUrls } from '~/config'
import { ONE_MILLION_USDT } from '~/playwright/anvil/utils'
import { expect, getTest } from '~/playwright/fixtures'
import { stubLiquidityServiceEndpoint } from '~/playwright/fixtures/liquidityService'
import { Mocks } from '~/playwright/mocks/mocks'
import { assume0xAddress } from '~/utils/wagmi'

const test = getTest({ withAnvil: true })

test.describe(
  'Increase liquidity',
  {
    tag: '@team:apps-lp',
    annotation: [
      { type: 'DD_TAGS[team]', description: 'apps-lp' },
      { type: 'DD_TAGS[test.type]', description: 'web-e2e' },
    ],
  },
  () => {
    test.describe('approval flow', () => {
      test('should approve and increase liquidity on a V3 position', async ({ page, anvil }) => {
        await stubLiquidityServiceEndpoint({
          page,
          endpoint: LiquidityService.methods.increasePosition,
          service: LiquidityService,
        })
        await anvil.setErc20Balance({ address: assume0xAddress(USDT.address), balance: ONE_MILLION_USDT })
        await page.route(
          `${getUniswapServiceUrls().apiBaseUrlV2}/${getPosition.service.typeName}/${getPosition.name}`,
          async (route) => {
            await route.fulfill({ path: Mocks.Positions.get_v3_position })
          },
        )

        await page.goto('/positions/v3/ethereum/1028438')
        await page.getByRole('button', { name: 'Add liquidity' }).dblclick()
        await page.getByTestId(TestID.AmountInputIn).nth(1).click()
        await page.getByTestId(TestID.AmountInputIn).nth(1).fill('1')

        await page.getByRole('button', { name: 'Review' }).click()
        await page.getByRole('button', { name: 'Confirm' }).click()
        await expect(page.getByText('Approved').first()).toBeVisible()
      })
    })
  },
)
