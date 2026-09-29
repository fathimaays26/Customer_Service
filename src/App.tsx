import Overview from "./pages/Overview";
import EnquiryProfile from "./pages/EnquiryProfile";
import SLAResolutionAnalytics from "./pages/SLAResolutionAnalytics";
import CustomerSatisfaction from "./pages/CustomerSatisfaction";

import type { DashboardPage } from "./component/Header";
import { FilterProvider } from "./context/FilterContext";
import { useState } from "react";

export default function App() {
  const [activePage, setActivePage] =
    useState<DashboardPage>("Overview");

  return (
    <FilterProvider>
      {activePage === "Overview" ? (
        <Overview
          activePage={activePage}
          onPageChange={setActivePage}
        />
      ) : activePage === "Enquiry Profile" ? (
        <EnquiryProfile
          activePage={activePage}
          onPageChange={setActivePage}
        />
      ) : activePage === "SLA & Resolution Analytics" ? (
        <SLAResolutionAnalytics
          activePage={activePage}
          onPageChange={setActivePage}
        />
      ) : (
        <CustomerSatisfaction
          activePage={activePage}
          onPageChange={setActivePage}
        />
      )}
    </FilterProvider>
  );
}