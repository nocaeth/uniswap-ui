import {
  GNOSIS_SDAI,
  GNOSIS_SDAI_ADAPTER_ADDRESS,
  GNOSIS_USDCE,
  GNOSIS_WXDAI,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/constants'
import {
  GnosisSdaiAdapterDirection,
  getGnosisSdaiAdapterApprovalSpender,
  getGnosisSdaiAdapterDirection,
} from 'uniswap/src/features/transactions/swap/services/gnosisRouter/sdaiAdapter'

const NATIVE_XDAI_SENTINEL = '0x0000000000000000000000000000000000000000'

describe('sDAI adapter helpers', () => {
  it('detects xDAI/WXDAI -> sDAI adapter routes', () => {
    expect(getGnosisSdaiAdapterDirection({ tokenIn: NATIVE_XDAI_SENTINEL, tokenOut: GNOSIS_SDAI })).toBe(
      GnosisSdaiAdapterDirection.AssetToSdai,
    )
    expect(getGnosisSdaiAdapterDirection({ tokenIn: GNOSIS_WXDAI, tokenOut: GNOSIS_SDAI })).toBe(
      GnosisSdaiAdapterDirection.AssetToSdai,
    )
  })

  it('detects sDAI -> xDAI/WXDAI adapter routes', () => {
    expect(getGnosisSdaiAdapterDirection({ tokenIn: GNOSIS_SDAI, tokenOut: NATIVE_XDAI_SENTINEL })).toBe(
      GnosisSdaiAdapterDirection.SdaiToAsset,
    )
    expect(getGnosisSdaiAdapterDirection({ tokenIn: GNOSIS_SDAI, tokenOut: GNOSIS_WXDAI })).toBe(
      GnosisSdaiAdapterDirection.SdaiToAsset,
    )
  })

  it('leaves non-direct sDAI routes on the V3 router path', () => {
    expect(getGnosisSdaiAdapterDirection({ tokenIn: GNOSIS_USDCE, tokenOut: GNOSIS_SDAI })).toBeUndefined()
    expect(getGnosisSdaiAdapterDirection({ tokenIn: GNOSIS_SDAI, tokenOut: GNOSIS_USDCE })).toBeUndefined()
  })

  it('uses adapter approvals for ERC20 inputs and no approval for native input', () => {
    expect(
      getGnosisSdaiAdapterApprovalSpender({ tokenIn: NATIVE_XDAI_SENTINEL, tokenOut: GNOSIS_SDAI }),
    ).toBeUndefined()
    expect(getGnosisSdaiAdapterApprovalSpender({ tokenIn: GNOSIS_WXDAI, tokenOut: GNOSIS_SDAI })).toBe(
      GNOSIS_SDAI_ADAPTER_ADDRESS,
    )
    expect(getGnosisSdaiAdapterApprovalSpender({ tokenIn: GNOSIS_SDAI, tokenOut: GNOSIS_WXDAI })).toBe(
      GNOSIS_SDAI_ADAPTER_ADDRESS,
    )
  })
})
