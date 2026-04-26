Rails.application.routes.draw do
  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  namespace :api do
    namespace :v1 do
      get "health", to: "health#index"

      # Public shared trip (by token, no auth)
      get "shared/:token", to: "trips#shared"

      # User purge (called by Supabase delete-account edge function)
      delete "users/:id/purge", to: "users#purge"

      resources :trips do
        member do
          post :share
          delete :unshare
          # Combined extract + profile + build pipeline (replaces the old
          # auto-fired callbacks on link create + analyze-trip + resume).
          post :build
        end
        # Phase 4 — conflict alerts accumulated on day_plans during refine
        # or landmark-audit steps. The frontend lists pending ones and posts
        # a resolution ("keep" | "replace" | "remove") to clear them.
        get "conflicts", to: "conflicts#index"
        post "conflicts/resolve", to: "conflicts#resolve"
        resources :flights, except: [:new, :edit]
        resources :lodgings, except: [:new, :edit]
        resources :transports, except: [:new, :edit]
        resources :trip_notes, except: [:new, :edit]
        resources :day_plans do
          collection do
            patch :reorder
          end
          member do
            get :travel_times
            post :recalculate_schedule
            get :smart_suggestions
          end
          resources :itinerary_items do
            collection { patch :reorder }
            member do
              patch :move
              get :nearby_suggestions
              get :suggest_swap
            end
          end
        end
        resources :links, only: [:index, :show, :create, :update, :destroy]
      end

      # Pending links endpoint (for AI service polling)
      get "links/pending", to: "links#pending"

      post "google_places/search", to: "google_places#search"
      get "google_places/details", to: "google_places#details"
      get "google_places/autocomplete", to: "google_places#autocomplete"
    end
  end
end
