import { breakpoints } from 'ui/src/theme'
import { Body } from '~/app/layout/Body'
import { GRID_AREAS } from '~/app/layout/gridAreas'
import { Header } from '~/app/layout/Header'
import { OWL_FOUNTAIN_EVENT, OwlEffects } from '~/components/OwlEffects/OwlEffects'
import { deprecatedStyled } from '~/lib/deprecated-styled'

const AppContainer = deprecatedStyled.div`
  min-height: 100vh;
  max-width: 100vw;

  // grid container settings
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto auto 1fr;
  grid-template-areas: '${GRID_AREAS.HEADER}' '${GRID_AREAS.MAIN}' '${GRID_AREAS.MOBILE_BOTTOM_BAR}';
`
const AppBody = deprecatedStyled.div`
  grid-area: ${GRID_AREAS.MAIN};
  width: 100vw;
  min-height: 100%;
  max-width: ${({ theme }) => `${theme.maxWidth}px`};
  display: flex;
  flex-direction: column;
  position: relative;
  align-items: center;
  flex: 1;
  margin: auto;

  @media screen and (max-width: ${breakpoints.md}px) {
    padding-left: 10px;
    padding-right: 10px;
  }
`

const OwlFooter = deprecatedStyled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  padding: 16px 0 28px;
`

export function AppLayout() {
  return (
    <AppContainer>
      <Header />
      <AppBody>
        <Body />
      </AppBody>
      <OwlFooter>
        <button
          type="button"
          className="owl-btn"
          aria-label="Release the owls"
          title="Release the owls"
          onClick={() => window.dispatchEvent(new Event(OWL_FOUNTAIN_EVENT))}
        >
          🦉
        </button>
      </OwlFooter>
      <OwlEffects />
    </AppContainer>
  )
}
