import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Menu from "./pages/Menu";
import Location from "./pages/Location";
import Reviews from "./pages/Reviews";
import Order from "./pages/Order";
import NotFound from "./pages/NotFound";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/menu" component={Menu} />
      <Route path="/location" component={Location} />
      <Route path="/reviews" component={Reviews} />
      <Route path="/order" component={Order} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <Router />
      </ThemeProvider>
    </ErrorBoundary>
  );
}
